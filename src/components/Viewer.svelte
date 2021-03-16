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
    import { createModel, createPlaceholder, createObject } from '@core/modelTemplates';
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
        // create camera
        const camera = new pc.Entity();
        camera.addComponent('camera', {
            clearColor: new pc.Color(0, 0, 0, 0),
            farClip: 10000
        });
        app.root.addChild(camera);

        const light = new pc.Entity();
        light.addComponent("light", {
            type: "spot",
            range: 30
        });
        light.translate(0, 10, 0);
        app.root.addChild(light);

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
        app.xr.session.requestReferenceSpace('local').then((refSpace) => {
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
            placeContent(fakeLocationResult.geopose.pose, fakeLocationResult.scrs, pose)
        }

    }
    

     function convertGeoPose2PoseMat(globalPose) {
        let globalPositionLatLon = new LatLon(globalPose.latitude, globalPose.longitude, globalPose.altitude);
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

    function getRelativePosition(cameraGeoPose, objectGeoPose) {
        

        // first method
        // problem: cannot handle altitude differences, because distanceTo method only works on the surface of the ellipse
        const cam = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude/*, cameraGeoPose.altitude*/);
        const cam2objLat = new LatLon(objectGeoPose.latitude, cameraGeoPose.longitude/*, cameraGeoPose.altitude*/);
        const cam2objLon = new LatLon(cameraGeoPose.latitude, objectGeoPose.longitude/*, cameraGeoPose.altitude*/);
        //const cam2objAlt = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude/*, objectGeoPose.altitude*/);
        const dx = cam.distanceTo(cam2objLon);
        const dy = cam.distanceTo(cam2objLat);
        //const dz = cam.distanceTo(cam2objAlt);
        console.log("dx: " + dx + ", dy: " + dy/* + ", dz: " + dz*/);
        
        // second method
        const cameraPosition = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude, cameraGeoPose.altitude);
        const objectPosition = new LatLon(objectGeoPose.latitude, objectGeoPose.longitude, objectGeoPose.altitude);
        const diff = objectPosition.toCartesian().minus(cameraPosition.toCartesian());
        
        console.log("diff.x: " + diff.x + ", diff.y: " + diff.y + ", diff.z: " + diff.z);

        // TODO: Add y-value when receiving valid height value from GeoPose service
        return vec3.fromValues(dx*0.01, 0.0, -dy*0.01); // WARNING: change of coordinate axes!! Specific to AugmentedCity???
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
                



                /// NEW
                let localCameraPosition = vec3.create();
                mat4.getTranslation(localCameraPosition, localImagePoseMat4);
                let relativePosition = getRelativePosition(globalImagePose, globalObjectPose);
                
                //let localObjectPosition = vec3.create();
                //vec3.add(localObjectPosition, localCameraPosition, relativePosition);
                let localObjectPosition = relativePosition; // DEBUG: displace from origin instead of from camera
                ///



                const placeholder = createPlaceholder(record.content.keywords);
                //placeholder.setLocalRotation(q);
                //placeholder.setLocalPosition(t);
                //placeholder.setPosition(localObjectPosition);
                placeholder.translate(localObjectPosition);
                //console.log("object's local transform:");
                //console.log(placeholder.getLocalTransform());

                app.root.addChild(placeholder);
            }
        })


        // DEBUG: add something small at the positive X, Y, Z:
        const objX = createObject("box", new pc.Color(1,0,0));
        objX.setPosition(1,0,0);
        app.root.addChild(objX);
        const objY = createObject("sphere", new pc.Color(0,1,0));
        objY.setPosition(0,1,0);
        app.root.addChild(objY);
        const objZ = createObject("cone", new pc.Color(0,0, 1));
        objZ.setPosition(0,0,1);
        app.root.addChild(objZ);

        /*
        const light = createLight();
        app.root.addChild(light);

        let logo = new pc.Entity('logo');
        //logo.setPosition(0,0,0);
        app.root.addChild(logo);
        */

        app.scene.ambientLight = new pc.Color(0.8, 0.8, 0.8);
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
