<!--
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
-->

<!--
    Initializes and runs the AR session. Configuration will be according the data provided by the parent.
-->
<script>
    import { createEventDispatcher } from 'svelte';

    
    import '@thirdparty/playcanvas.min.js';
    import {v4 as uuidv4} from 'uuid';

    import { sendRequest, objectEndpoint, validateRequest } from 'gpp-access';
    import GeoPoseRequest from 'gpp-access/request/GeoPoseRequest.js';
    import ImageOrientation from 'gpp-access/request/options/ImageOrientation.js';
    import { IMAGEFORMAT } from 'gpp-access/GppGlobals.js';

    import { initialLocation, availableContentServices, currentMarkerImage,
        currentMarkerImageWidth, selectedGeoPoseService } from '@src/stateStore';
    import { createImageFromTexture, wait, ARMODES } from "@core/common";
    import { createModel, createPlaceholder, createObject, addLight, addLogo, addAxes } from '@core/modelTemplates';
    import { calculateLocalLocation, fakeLocationResult } from '@core/locationTools';

    import { initializeGLCube, drawScene } from '@core/texture';
    import ArCloudOverlay from "./dom-overlays/ArCloudOverlay.svelte";
    import MarkerOverlay from "./dom-overlays/MarkerOverlay.svelte";

    import {mat4, vec4, mat3, vec3, quat} from 'gl-matrix';
    import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
    
    
    export let activeArMode;


    const message = (msg) => console.log(msg);

    // Used to dispatch events to parent
    const dispatch = createEventDispatcher();

    let canvas, overlay;

    let app;

    let captureImage = false;
    let showFooter = false, hasPose = false, isLocalizing = false, isLocalized = false;

    let xrRefSpace = null;
    let gl = null;
    let glBinding = null;
    let cameraShader = null;

    let trackedImage, trackedImageObject;


    /**
     * Verifies that AR is available as required by the provided configuration data, and starts the session.
     */
    export function startAr() {
        showFooter = true;

        app = new pc.Application(canvas, {
            mouse: new pc.Mouse(canvas),
            touch: new pc.TouchDevice(canvas),
            graphicsDeviceOptions: {alpha: true}
        });

        app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);
        app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;
        app.start();

        app.xr.on('start', () => {
            message("Immersive AR session has started");
        });

        app.xr.on('update', (frame) => {
            onUpdate(frame);
        })

        app.xr.on('end', () => {
            message("Immersive AR session has ended");

            app = null;
            dispatch('arSessionEnded');
        });

        app.xr.on('available:' + pc.XRTYPE_AR, (available) => {
            message("Immersive AR is " + (available ? 'available' : 'unavailable'));
            if (available && !app.xr.active) {
                const camera = setupEnvironment();
                startSession(camera);
            }
        });

        window.addEventListener("resize", () => {
            if (app) app.resizeCanvas(canvas.width, canvas.height);
        });
    }

    /**
     * Set up the 3D environment as required according to the current real environment.*
     */
    function setupEnvironment() {
        // add camera
        const camera = new pc.Entity();
        camera.addComponent('camera', {
            clearColor: new pc.Color(0, 0, 0, 0),
            nearClip: 0.001,
            farClip: 10000
        });
        app.root.addChild(camera);

        // add ambient light
        app.scene.ambientLight = new pc.Color(0.8, 0.8, 0.8);

        // add spotlight
        const light = new pc.Entity();
        light.addComponent("light", {
            type: "spot",
            range: 30
        });
        light.translate(0, 10, 0);
        app.root.addChild(light);


        addLight(app);

        addAxes(app);

        //addLogo(app); // async


        return camera;
    }

    /**
     * Setup required AR features and start the XRSession.
     */
    function startSession(camera) {
        app.xr.domOverlay.root = overlay;

        let options = {};

        if (activeArMode === ARMODES.oscp) {
            options = {
                requiredFeatures: ['dom-overlay', 'camera-access'],
                callback: oscpModeCallback
            }
            //camera.camera.startXr(pc.XRTYPE_AR, pc.XRSPACE_LOCALFLOOR, options);
            // XRSPACE_UNBOUNDED -- PlayCanvas documentation says this is for untethered VR, and for AR we should use VIEWER
            camera.camera.startXr(pc.XRTYPE_AR, pc.XRSPACE_UNBOUNDED, options);
            //camera.camera.startXr(pc.XRTYPE_AR, pc.XRSPACE_VIEWER, options);
        } else if (activeArMode === ARMODES.marker) {
            options = {
                requiredFeatures: ['image-tracking'],
                imageTracking: true,
                callback: markerModeCallback
            }
            setupMarkers()
                .then(() => camera.camera.startXr(pc.XRTYPE_AR, pc.XRSPACE_LOCALFLOOR, options));
        }
    }

    /**
     * Load marker and configure marker tracking.
     */
    function setupMarkers() {
        return fetch(`/media/${$currentMarkerImage}`)
            .then(response => response.blob())
            .then(blob => {
                trackedImage = app.xr.imageTracking.add(blob, $currentMarkerImageWidth);
            })
            .catch(error => console.log(error));
    }

    /**
     * Executed when XRSession was successfully created for AR mode 'marker'.
     */
    function markerModeCallback(error) {
        if (error) {
            message("WebXR Immersive AR failed to start: " + error.message);
            throw new Error(error.message);
        }

        app.xr.session.requestReferenceSpace('local').then((refSpace) => {
            xrRefSpace = refSpace;
        });
    }

    /**
     * Executed when XRSession was successfully created for AR mode 'oscp'.
     */
    function oscpModeCallback(error) {
        if (error) {
            message("WebXR Immersive AR failed to start: " + error.message);
            throw new Error(error.message);
        }

        gl = canvas.getContext('webgl2', {xrCompatible: true});
        glBinding = new XRWebGLBinding(app.xr.session, gl);

        // cameraShader = initializeGLCube(gl);

        app.xr.session.updateRenderState({baseLayer: new XRWebGLLayer(app.xr.session, gl)});
        //app.xr.session.requestReferenceSpace('local').then((refSpace) => {
            app.xr.session.requestReferenceSpace('unbounded').then((refSpace) => {
            xrRefSpace = refSpace;
        });
    }

    /**
     * Trigger localisation of the device globally using a GeoPose service.
     */
    function startLocalisation() {
        captureImage = true;
        isLocalizing = true;
    }

    /**
     * Animation loop.
     *
     * @param frame
     */
    function onUpdate(frame) {
        const pose = frame.getViewerPose(xrRefSpace);

        if (activeArMode === ARMODES.oscp && pose) {
            hasPose = true;
            handlePose(pose, frame);
        } else if (activeArMode === ARMODES.marker) {
            handleMarker();
        }
    }

    /**
     * Handles update loop when marker mode is used.
     */
    function handleMarker() {
        if (trackedImage && trackedImage.tracking) {
            if (!trackedImageObject) {
                trackedImageObject = createModel();
                app.root.addChild(trackedImageObject);
            }

            trackedImageObject.setPosition(trackedImage.getPosition());
            trackedImageObject.setRotation(trackedImage.getRotation());
        }
    }

    /**
     * Handles update loop when ARCloud mode is used.
     *
     * @param pose      The pose of the device as reported by the XRFrame
     * @param frame     The XRFrame provided to the update loop
     */
    function handlePose(pose, frame) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, app.xr.session.renderState.baseLayer.framebuffer);

        for (let view of pose.views) {
            let viewport = app.xr.session.renderState.baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

            if (captureImage) {
                captureImage = false;

                cameraShader = initializeGLCube(gl);
                const cameraTexture = glBinding.getCameraImage(frame, pose.cameraViews[0]);
                drawScene(gl, cameraTexture, view);

                const image = createImageFromTexture(gl, cameraTexture, viewport.width, viewport.height);

                // To verify if the image was captured correctly
                // const img = new Image();
                // img.src = image;
                // document.body.appendChild(img);

                gl.deleteProgram(cameraShader);
                cameraShader = null;

                // TODO: Make this a promise
                localize(pose, image, viewport.width, viewport.height);
            }
        }
    }

    /**
     * Does the actual localisation with the image shot before and the preselected GeoPose service.
     *
     * When request is successful, content reported from the content discovery server will be placed. When
     * request is unsuccessful, user is offered to localize again or use a marker image as an alternative.
     *
     * @param pose  XRPose      Pose of the device as reported by the XRFrame
     * @param image  string     Camera image to use for localisation
     * @param width  Number     Width of the camera image
     * @param height  Number    Height of the camera image
     */
    function localize(pose, image, width, height) {
        const geoPoseRequest = new GeoPoseRequest(uuidv4())
            .addCameraData(IMAGEFORMAT.JPG, [width, height], image.split(',')[1], 0, new ImageOrientation(false, 0))
            .addLocationData($initialLocation.lat, $initialLocation.lon, 0, 0, 0, 0, 0);

        // Services haven't implemented recent changes to the protocol yet
        validateRequest(false);

        const start = Date.now();
/*
        sendRequest(`${$availableContentServices[0].url}/${objectEndpoint}`, JSON.stringify(geoPoseRequest))
            .then(data => {
                console.log('Duration', Date.now() - start);

                isLocalized = true;
                wait(1000).then(showFooter = false);

                console.log('successfully localized!!', data)

                if ('scrs' in data) {
                    placeContent(data.geopose.pose, data.scrs, pose);
                }
            })
            .catch(error => {
                isLocalizing = false;

                // TODO: Offer marker alternative

                console.error(error);
            });
*/

        // Fake data for development
        {
            console.log('fake localisation');
            isLocalized = true;
            wait(1000).then(showFooter = false);
            placeContent(fakeLocationResult.geopose.pose, fakeLocationResult.scrs, pose);
        }

    }
    
    function convertGeoPose2PoseMat(globalPose) {
        // WARNING: AugmentedCity returns incorrect altitude! So we assume here that we are on the Earth surface.
        //let globalPositionLatLon = new LatLon(globalPose.latitude, globalPose.longitude, globalPose.altitude);
        let globalPositionLatLon = new LatLon(globalPose.latitude, globalPose.longitude);

        let globalPositionCartesian = globalPositionLatLon.toCartesian();
        let globalPositionVec3 = vec3.fromValues(globalPositionCartesian.x, globalPositionCartesian.y, globalPositionCartesian.z);
        //console.log(globalPositionVec3);
        let globalOrientationArray = globalPose.quaternion;
        let globalOrientationQuat = quat.fromValues(globalOrientationArray[0], globalOrientationArray[1], globalOrientationArray[2], globalOrientationArray[3]);
        //console.log(globalOrientationQuat);
        let globalPoseMat4 = mat4.create();
        mat4.fromRotationTranslation(globalPoseMat4, globalOrientationQuat, globalPositionVec3);
        //console.log(globalPoseMat4);
        return globalPoseMat4;
    }

    /**
    *  Calculates the relative position of two geodesic locations.
    *
    *  Used to calculate the relative distance between the device at the moment of localization and the
    *  location of an object received from a content discovery service.
    *
    * @param cameraGeoPose  GeoPose of the camera returned by the localization service
    * @param objectGeoPose  GeoPose of an object
    * @returns vec3         Relative position of the object with respect to the camera
    */ 
    function getRelativeGlobalPosition(cameraGeoPose, objectGeoPose) {
        // first method, Geo
        const cam = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude);
        const cam2objLat = new LatLon(objectGeoPose.latitude, cameraGeoPose.longitude);
        const cam2objLon = new LatLon(cameraGeoPose.latitude, objectGeoPose.longitude);
        const dx = cam.distanceTo(cam2objLon);
        const dy = cam.distanceTo(cam2objLat);
        const dz = objectGeoPose.altitude - cameraGeoPose.altitude; // WARNING: AugmentedCity returns invalid height!
        console.log("dx: " + dx + ", dy: " + dy + ", dz: " + dz);
        

        // TODO: REMOVE, this is wrong!
        // second method, ECEF
        // WARNING: AugmentedCity returns invalid height!
        const cameraPosition = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude/*, cameraGeoPose.altitude*/);
        const objectPosition = new LatLon(objectGeoPose.latitude, objectGeoPose.longitude/*, objectGeoPose.altitude*/);
        const diff = objectPosition.toCartesian().minus(cameraPosition.toCartesian());
        console.log("diff.x: " + diff.x + ", diff.y: " + diff.y + ", diff.z: " + diff.z);

        // TODO: Add y-value when receiving valid height value from GeoPose service
        // WARNING: change of coordinate axes to match WebGL coordinate system
        return vec3.fromValues(dx, 0.0, -dy);
    }

    /**
    *  Calculates the relative orientation of two geodesic locations.
    *
    *  Used to calculate the relative orientation between the device at the moment of localization and the
    *  location of an object received from a content discovery service.
    *
    * @param cameraGeoPose  GeoPose of the camera returned by the localization service
    * @param objectGeoPose  GeoPose of an object
    * @returns quat         Relative orientation of the object with respect to the camera
    */ 
    function getRelativeGlobalOrientation(cameraGeoPose, objectGeoPose) {
        // camera orientation
        const qCam = quat.fromValues(
                cameraGeoPose.quaternion[0],
                cameraGeoPose.quaternion[1],
                cameraGeoPose.quaternion[2],
                cameraGeoPose.quaternion[3]);
        // object orientation
        const qObj = quat.fromValues(
                objectGeoPose.quaternion[0],
                objectGeoPose.quaternion[1],
                objectGeoPose.quaternion[2],
                objectGeoPose.quaternion[3]);
        // NOTE: if q2 = qdiff * q1, then  qdiff = q2 * inverse(q1)
        let qCamInv = quat.create();
        quat.invert(qCamInv, qCam); 
        let qRel = quat.create();
        quat.multiply(qRel, qObj, qCamInv);
        return qRel;
    }

    function getObjectPosition(){
        
    }

    /**
     *  Places the content provided by a call to a Spacial Content Discovery server.
     *
     * @param globalPose  GeoPose
     * @param scr  SCR    Spatial Content Record with the result from the server request
     * @param localPose XRPose    The pose of the device when localisation was started
     */
    function placeContent(globalPose, scr, localPose) {
        console.log('local image pose:');
        let localImagePoseMat4 = localPose.transform.matrix;
        console.log(localImagePoseMat4);

        console.log('global image GeoPose:');
        let globalImagePose = globalPose;
        console.log(globalImagePose);
        
        console.log('global image pose:');
        let globalImagePoseMat4 = convertGeoPose2PoseMat(globalPose);
        console.log(globalImagePoseMat4);

        console.log('global image pose inverse:');
        let globalImagePoseInvMat4 = mat4.create();
        mat4.invert(globalImagePoseInvMat4, globalImagePoseMat4);
        console.log(globalImagePoseInvMat4);
        

        console.log("TEST inverse:");
        let test = mat4.create();
        mat4.multiply(test, globalImagePoseMat4, globalImagePoseInvMat4);
        console.log(test); // this should be identity matrix - OK


        scr.forEach(record => {
            console.log("=== SCR ===========")
            // This is difficult to generalize, because there are no types defined yet.
            if (record.content.type === 'placeholder') {
                if ($availableContentServices[0].url.includes('augmented.city')) {
                    record.content.geopose.pose = flipLatLon(record.content.geopose.pose);
                }
                
                /*
                const localPosition = localPose.transform.position;

                // Augmented City special path for the GeoPose. Should be just 'record.content.geopose'
                const contentPosition = calculateLocalLocation(globalPose, record.content.geopose.pose);
                const placeholder = createPlaceholder(record.content.keywords);
                placeholder.setPosition(
                    contentPosition.x + localPosition.x,
                    contentPosition.y + localPosition.y,
                    contentPosition.z + localPosition.z);
                // TODO: placeholder.setRotation(0, 0, 0);
                console.log(contentPosition);
                */

                //NOTE: what is the LatLon library's Cartesian coordinate system?
                // Do we need to change axes here?

                // NOTE: from the oscp-demo-client.py (Augmented City)
                // Spatial Content Record GeoPose represents object's frame (Z up, X forward direction) in ECEF coordinate system,
                // so that it is correctly oriented with respect to North direction and vertical axis and placed about WGS84
                // ellipsoid level.


                //NOTE: WebXR coordinate system: 
                // X to the right
                // Y to up
                // Z outwards from the screen

                

                console.log("global object GeoPose:");
                let globalObjectPose = record.content.geopose.pose;
                console.log(globalObjectPose);

                console.log("global object pose:");
                let globalObjectPoseMat4 = convertGeoPose2PoseMat(globalObjectPose);
                console.log(globalObjectPoseMat4);


                // NOTE: gl-matrix has weird notation order for operations
                // if you want output = matrixB * matrixA, 
                // then you need to write mat.multiply(output, matrixA, matrixB);

                // NOTE:
                //Tcam2model = Tgeo2model *  Tpic2geo * Tcam2pic
                //Tcam2model = Tgeo2model *  inv(Tgeo2pic) * Tcam2pic
                //conceptually it should read the other way round: Tcam2model = Tcam2pic * Tpic2geo * Tgeo2model 
                
                
                console.log("temp0:");
                let temp0 = mat4.create();
                console.log(temp0);

                console.log("temp1:");
                let temp1 = mat4.create();
                mat4.multiply(temp1, temp0, globalObjectPoseMat4);
                console.log(temp1);

                console.log("temp2:");
                let temp2 = mat4.create();
                mat4.multiply(temp2, temp1, globalImagePoseInvMat4);
                console.log(temp2);

                console.log("temp3:");
                let temp3 = mat4.create();
                mat4.multiply(temp3, temp2, localImagePoseMat4);
                console.log(temp3);

                console.log("local object pose:");
                let localObjectPoseMat4 = temp3;
                console.log(localObjectPoseMat4);

                let q = quat.create(); mat4.getRotation(q, localObjectPoseMat4);
                let t = vec3.create(); mat4.getTranslation(t, localObjectPoseMat4);
                let s = vec3.create(); mat4.getScaling(s, localObjectPoseMat4); // this should be all 1s - OK
                

                //////////////////

                const placeholder = createPlaceholder(record.content.keywords);
                
                //placeObject(placeholder, localImagePoseMat4, globalObjectPose, globalImagePose);


                let relativePosition = getRelativeGlobalPosition(globalImagePose, globalObjectPose);
                let relativeOrientation = getRelativeGlobalOrientation(globalImagePose, globalObjectPose);
                console.log("relativePosition:");
                console.log(relativePosition);
                console.log("relativeOrientation:");
                console.log(relativeOrientation);
                // TODO: The global coordinate system is right handed with Z up. 
                // now change to WebGL coordinate system (right handed, Y up)
                //...

                let localCameraPosition = vec3.create();
                mat4.getTranslation(localCameraPosition, localImagePoseMat4);
                let localObjectPosition = vec3.create();
                vec3.add(localObjectPosition, localCameraPosition, relativePosition);
                
                let localCameraOrientation = quat.create();
                mat4.getRotation(localCameraOrientation, localImagePoseMat4);
                let localObjectOrientation = quat.create();
                quat.multiply(localObjectOrientation, relativeOrientation, localCameraOrientation);
                

                console.log("localObjectPosition:");
                console.log(localObjectPosition);
                console.log("localObjectOrientation:");
                console.log(localObjectOrientation);
                
                q = localObjectOrientation;
                t = localObjectPosition;
                //placeholder.setLocalRotation(q);
                //placeholder.setLocalPosition(t);
                placeholder.setPosition(localObjectPosition[0], localObjectPosition[1], localObjectPosition[2]); // from vec3 to Vec3
                placeholder.setRotation(localObjectOrientation[0], localObjectOrientation[1], localObjectOrientation[2], localObjectOrientation[3]); // from quat to Quat
                //placeholder.translate(localObjectPosition);
                //console.log("object's local transform:");
                //console.log(placeholder.getLocalTransform());

                app.root.addChild(placeholder);
            }
        })

    }


    /*
        Augmented city does return lat lon mixed up right now
     */
    function flipLatLon(pose) {
        const temp = pose.latitude;
        pose.latitude = pose.longitude;
        pose.longitude = temp;

        return pose;
    }

    
    
    

</script>


<style>
    canvas {
        width: 100vw;
        height: 100vh;
    }

    aside footer {
        position: absolute;
        bottom: 0;

        margin: var(--ui-margin);
        padding: var(--ui-margin);

        width: calc(100vw - 4 * var(--ui-margin));

        border: 1px solid black;
        border-radius: var(--ui-radius);
        background-color: white;

        text-align: center;
    }
</style>


<canvas id='application' bind:this={canvas}></canvas>
<aside bind:this={overlay} on:beforexrselect={(event) => event.preventDefault()}>
    {#if showFooter}
        <footer>
            {#if activeArMode === ARMODES.oscp}
            <ArCloudOverlay hasPose="{hasPose}" isLocalizing="{isLocalizing}" isLocalized="{isLocalized}"
                        on:startLocalisation={startLocalisation} />
            {:else if activeArMode === ARMODES.marker}
                <MarkerOverlay />
            {:else}
                <p>Somethings wrong...</p>
                <p>Apologies.</p>
            {/if}
        </footer>
    {/if}
</aside>
