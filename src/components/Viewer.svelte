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
        currentMarkerImageWidth, recentLocalisation,
        debug_appendCameraImage, debug_showLocationAxis, debug_useLocalServerResponse} from '@src/stateStore';
    import { wait, ARMODES, debounce } from "@core/common";
    import { createModel, createPlaceholder, addAxes, createObject, addLight, addLogo } from '@core/modelTemplates';
    import { calculateDistance, fakeLocationResult, calculateEulerRotation, calculateRotation, toDegrees, getColorForContentId } from '@core/locationTools';
    import { initCameraCaptureScene, drawCameraCaptureScene, createImageFromTexture } from '@core/cameraCapture';
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

    let doCaptureImage = false;
    let showFooter = false, hasPose = false, isLocalizing = false, isLocalized = false, hasLostTracking = false;

    let xrRefSpace = null, gl = null, glBinding = null;
    let trackedImage, trackedImageObject;
    let poseFoundHeartbeat = null;


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
        // TODO: Use environmental lighting?!

        // create camera
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

        if ($debug_showLocationAxis) {
            addAxes(app);
        }

        return camera.camera;
    }

    /**
     * Setup required AR features and start the XRSession.
     */
    function startSession(camera) {
        app.xr.domOverlay.root = overlay;

        if (activeArMode === ARMODES.oscp) {
            // pc.XRSPACE_LOCALFLOOR
            // pc.XRSPACE_UNBOUNDED
            // pc.XRSPACE_VIEWER
            // -- PlayCanvas documentation says this is for untethered VR, and for AR we should use VIEWER
            camera.startXr(pc.XRTYPE_AR, pc.XRSPACE_UNBOUNDED, {
                requiredFeatures: ['dom-overlay', 'camera-access'],
                callback: onXRSessionStartedOSCP
            });
        } else if (activeArMode === ARMODES.marker) {
            setupMarkers()
                .then(() => camera.startXr(pc.XRTYPE_AR, pc.XRSPACE_LOCALFLOOR, {
                        requiredFeatures: ['image-tracking'],
                        imageTracking: true,
                        callback: onXRSessionStartedMarker
                    }
                ));
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
    function onXRSessionStartedMarker(error) {
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
    function onXRSessionStartedOSCP(error) {
        if (error) {
            message("WebXR Immersive AR failed to start: " + error.message);
            throw new Error(error.message);
        }

        gl = canvas.getContext('webgl2', {xrCompatible: true}); // NOTE: preserveDrawingBuffer: true seems to have no effect
        glBinding = new XRWebGLBinding(app.xr.session, gl);

        app.xr.session.updateRenderState({baseLayer: new XRWebGLLayer(app.xr.session, gl)});
        //app.xr.session.requestReferenceSpace('local-floor').then((refSpace) => {
        app.xr.session.requestReferenceSpace('unbounded').then((refSpace) => {
            xrRefSpace = refSpace;
        });

        initCameraCaptureScene(gl);
    }

    /**
     * Trigger localisation of the device globally using a GeoPose service.
     */
    function startLocalisation() {
        doCaptureImage = true;
        isLocalizing = true;
    }

    /**
     * Animation loop.
     *
     * @param frame
     */
    function onUpdate(frame) {
        const localPose = frame.getViewerPose(xrRefSpace);

        if (localPose) {
            handlePoseHeartbeat();

            if (activeArMode === ARMODES.oscp) {
                hasPose = true;
                handlePose(localPose, frame);
            } else if (activeArMode === ARMODES.marker) {
                handleMarker();
            }
        }
    }

    /**
     * Handles a pose found heartbeat. When it's not triggered for a specific time (300ms as default) an indicator
     * is shown to let the user know that the tracking was lost.
     */
    function handlePoseHeartbeat() {
        hasLostTracking = false;
        if (poseFoundHeartbeat === null) {
            poseFoundHeartbeat = debounce(() => hasLostTracking = true);
        }

        poseFoundHeartbeat();
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
     * Handles update loop when AR Cloud mode is used.
     *
     * @param localPose The pose of the device as reported by the XRFrame
     * @param frame     The XRFrame provided to the update loop
     */
    function handlePose(localPose, frame) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, app.xr.session.renderState.baseLayer.framebuffer);

        // TODO: Correctly handle multiple views. No need to localize twice for glasses.
        for (let view of localPose.views) {
            let viewport = app.xr.session.renderState.baseLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            
            // NOTE: if we do not draw anything on pose update for more than 5 frames, Chrome's WebXR sends warnings
            // See OnFrameEnd() in https://chromium.googlesource.com/chromium/src/third_party/+/master/blink/renderer/modules/xr/xr_webgl_layer.cc

            // We want to capture the camera image, however, it is not directly available here,
            // but only as a GPU texture. We draw something textured with the camera image at every frame,
            // so that the texture is kept in GPU memory. We can then capture it below.
            let cameraTexture = null;
            if (!isLocalized) {
                cameraTexture = glBinding.getCameraImage(frame, view);
                drawCameraCaptureScene(gl, cameraTexture);
            }

            if (doCaptureImage) {
                doCaptureImage = false;

                // TODO: try to queue the camera capture code on XRSession.requestAnimationFrame()

                const image = createImageFromTexture(gl, cameraTexture, viewport.width, viewport.height);
                
                if ($debug_appendCameraImage) {
                    // DEBUG: verify if the image was captured correctly
                    const img = new Image();
                    img.src = image;
                    document.body.appendChild(img);
                }

                localize(localPose, image, viewport.width, viewport.height)
                    // When localisation didn't already provide content, needs to be requested here
                    .then(([geoPose, data]) => {
                        $recentLocalisation.geopose = geoPose;
                        $recentLocalisation.localpose = localPose.transform;

                        placeContent(localPose, geoPose, data);
                    });
            }
        }
    }

    /**
     * Does the actual localisation with the image shot before and the preselected GeoPose service.
     *
     * When request is successful, content reported from the content discovery server will be placed. When
     * request is unsuccessful, user is offered to localize again or use a marker image as an alternative.
     *
     * @param localPose  XRPose      Pose of the device as reported by the XRFrame
     * @param image  string     Camera image to use for localisation
     * @param width  Number     Width of the camera image
     * @param height  Number    Height of the camera image
     */

    function localize(localPose, image, width, height) {
        return new Promise((resolve, reject) => {
            if (!$debug_useLocalServerResponse) {
                const geoPoseRequest = new GeoPoseRequest(uuidv4())
                    .addCameraData(IMAGEFORMAT.JPG, [width, height], image.split(',')[1], 0, new ImageOrientation(false, 0))
                    .addLocationData($initialLocation.lat, $initialLocation.lon, 0, 0, 0, 0, 0);

                // Services haven't implemented recent changes to the protocol yet
                validateRequest(false);

                sendRequest(`${$availableContentServices[0].url}/${objectEndpoint}`, JSON.stringify(geoPoseRequest))
                    .then(data => {
                        isLocalizing = false;
                        isLocalized = true;
                        wait(1000).then(showFooter = false);

                        if ('scrs' in data) {
                            resolve([data.geopose.pose, data.scrs]);
                        }
                    })
                    .catch(error => {
                        // TODO: Offer marker alternative
                        isLocalizing = false;
                        console.error(error);
                        reject(error);
                    });
            } else {
                // Stored SCD response for development
                console.log('fake localisation');
                isLocalized = true;
                wait(1000).then(showFooter = false);  // TODO: resolve AFTER the 1sec? .then()
                resolve([fakeLocationResult.geopose.pose, fakeLocationResult.scrs])
            }
        });
    }


    // TODO: 
    //DEBUG:load image from test file
    //function loadDefaultPhoto() {
    //    "media/IMG_20210317_095716_hdr.jpg"
    //}


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
        let dz = objectGeoPose.altitude - cameraGeoPose.altitude; 
        console.log("dx: " + dx + ", dy: " + dy + ", dz: " + dz);

        // TODO: Add y-value when receiving valid height value from GeoPose service
        // WARNING: AugmentedCity sometimes returns invalid height!
        // Therefore we set the dz=0
        //dz = 0.0;

        // TODO: REMOVE, this is wrong!
        // second method, ECEF
        const cameraPosition = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude, cameraGeoPose.altitude);
        const objectPosition = new LatLon(objectGeoPose.latitude, objectGeoPose.longitude, objectGeoPose.altitude);
        const diff = objectPosition.toCartesian().minus(cameraPosition.toCartesian());
        console.log("diff.x: " + diff.x + ", diff.y: " + diff.y + ", diff.z: " + diff.z);

        
        // WARNING: in the next step, change of coordinate axes might be necessary to match WebGL coordinate system
        //return vec3.fromValues(dx, dz, -dy);
        return vec3.fromValues(dx, dy, dz);  // do not change axes yet
    }

    function convertGeo2WebVec3(geoVec3) {
        let webVec3 = vec3.fromValues(geoVec3[0], geoVec3[2], -geoVec3[1]);
        return webVec3;
    }
    function convertWeb2GeoVec3(webVec3) {
        let geoVec3 = vec3.fromValues(webVec3[0], -webVec3[2], webVec3[1]);
        return geoVec3;
    }
    function convertGeo2WebQuat(geoQuat) {
        let webQuat = quat.fromValues(geoQuat[0], geoQuat[2], -geoQuat[1], geoQuat[3]);
        return webQuat;
    }
    function convertWeb2GeoQuat(webQuat) {
        let geoQuat = vec3.fromValues(webQuat[0], -webQuat[2], webQuat[1], webQuat[3]);
        return geoQuat;
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

        // WARNING: in the next step, change of coordinate axes might be necessary to match WebGL coordinate system
        //return quat.fromValues(qRel[0], qRel[2], -qRel[1], qRel[3]);
        return qRel; // do not change axes yet
    }

    // TODO: placeObject
    //function placeObject(entity, localCameraPose, globalObjectPose, globalCameraPose){
    //
    //}

    /**
     *  Places the content provided by a call to a Spacial Content Discovery server.
     *
     * @param localPose XRPose      The pose of the device when localisation was started in local reference space
     * @param globalPose  GeoPose       The global GeoPose as returned from GeoPose service
     * @param scr  SCR Spatial      Content Record with the result from the server request
     */
    function placeContent(localPose, globalPose, scr) {
        
        console.log('local image pose:');
        let localImagePoseMat4 = localPose.transform.matrix;
        console.log(localImagePoseMat4);

        console.log('global image GeoPose:');
        let globalImagePose = globalPose;
        console.log(globalImagePose);
        
        /*
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
        */

        let virtualCamera = new pc.Entity(); // This is a virtual node at the local camera pose where the photo was taken
        let cameraBox = createObject("box", new pc.Color(1,1,0)); // yellow // this represents the camera with a model.
        cameraBox.setLocalScale(0.01, 0.02, 0.03);
        virtualCamera.addChild(cameraBox);
        app.root.addChild(virtualCamera);
        virtualCamera.setPosition(localPose.transform.position.x,
                                  localPose.transform.position.y,
                                  localPose.transform.position.z);
        virtualCamera.setRotation(localPose.transform.orientation.x,
                                  localPose.transform.orientation.y,
                                  localPose.transform.orientation.z,
                                  localPose.transform.orientation.w);
        
        let web2geoTransformNode = new pc.Entity(); // This is a virtual node for coordinate system change
        web2geoTransformNode.setLocalPosition(0,0,0);
//        web2geoTransformNode.setLocalEulerAngles(0,0,90); // additional 90 deg rotation around forward axis
        virtualCamera.addChild(web2geoTransformNode);
        web2geoTransformNode.rotateLocal(0,-90,0);
        


        // DEBUG: place GeoPose of camera itself as a content entry, this should appear exactly where the picture was taken
        const geoCam = createPlaceholder("geoCam");
        let relativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose);
        let relativeOrientation = getRelativeGlobalOrientation(globalImagePose, globalImagePose);        
        geoCam.setLocalPosition(relativePosition[0], relativePosition[1], relativePosition[2]); // from vec3 to Vec3
        geoCam.setLocalRotation(relativeOrientation[0], relativeOrientation[1], relativeOrientation[2], relativeOrientation[3]); // from quat to Quat
        
        web2geoTransformNode.addChild(geoCam);



        let cnt = 0;
        scr.forEach(record => {
            console.log("=== SCR ===========")

            // Augmented City special path for the GeoPose. Should be just 'record.content.geopose'
            let objectPose = record.content.geopose.pose;

            console.log("global object GeoPose:");
            let globalObjectPose = record.content.geopose.pose;
            console.log(globalObjectPose);

            console.log("global object pose:");
            let globalObjectPoseMat4 = convertGeoPose2PoseMat(globalObjectPose);
            console.log(globalObjectPoseMat4);

/*
            //HACK: line up objects
            globalObjectPose.quaternion[0] = 0;
            globalObjectPose.quaternion[1] = 0;
            globalObjectPose.quaternion[2] = 0;
            globalObjectPose.quaternion[3] = 1;
            globalObjectPose.latitude = globalPose.latitude - 0.0001;
            globalObjectPose.longitude = globalPose.longitude + 0.0001 * cnt; cnt = cnt + 1;
            globalObjectPose.altitude = 0;
*/

            // This is difficult to generalize, because there are no types defined yet.
            if (record.content.type === 'placeholder') {


/*
                const localPosition = localPose.transform.position;
                const contentPosition = calculateDistance(globalPose, objectPose);
                const placeholder = createPlaceholder(record.content.keywords);
                placeholder.setPosition(contentPosition.x + localPosition.x,
                                        contentPosition.y + localPosition.y,
                                        contentPosition.z + localPosition.z);
                const dRotation = calculateRotation(globalPose.quaternion, localPose.transform.orientation);
                const rotation = quat.fromValues(dRotation[0], dRotation[2], -dRotation[1], dRotation[3]); // from Geo to WebGL axes
                placeholder.setRotation(rotation[0], rotation[1], rotation[2], rotation[3]); // from quat to Quat
*/

/*
                // rotate everything by how much the camera has rotated so far
                let qCam = quat.create();
                mat4.getRotation(qCam, localPose.transform.matrix);
                placeholder.setRotation(qCam);
*/
                //////////////

                const placeholder = createPlaceholder(record.content.keywords, getColorForContentId(record.content.id));

                let relativePosition = getRelativeGlobalPosition(globalImagePose, globalObjectPose);
                let relativeOrientation = getRelativeGlobalOrientation(globalImagePose, globalObjectPose);
                // WARNING: change from Geo to WebGL coordinate system: 
                //relativePosition = convertGeo2WebVec3(relativePosition);
                //relativeOrientation = convertGeo2WebQuat(relativeOrientation);
                // set LOCAL transformation w.r.t parent virtualCamera
                placeholder.setLocalPosition(relativePosition[0], relativePosition[1], relativePosition[2]); // from vec3 to Vec3
                placeholder.setLocalRotation(relativeOrientation[0], relativeOrientation[1], relativeOrientation[2], relativeOrientation[3]); // from quat to Quat
                //let globalObjectOrientation = quat.fromValues(globalObjectPose.quaternion[0], globalObjectPose.quaternion[1], globalObjectPose.quaternion[2], globalObjectPose.quaternion[3])
                //placeholder.setLocalRotation(globalObjectOrientation[0], globalObjectOrientation[1], globalObjectOrientation[2], globalObjectOrientation[3]); // from quat to Quat
                web2geoTransformNode.addChild(placeholder);

                //////////////

                //NOTE: what is the LatLon library's Cartesian coordinate system?
                // Do we need to change axes here?

                // NOTE: from the oscp-demo-client.py (Augmented City)
                // Spatial Content Record GeoPose represents object's frame (Z up, X forward direction) in ECEF coordinate system,
                // so that it is correctly oriented with respect to North direction and vertical axis and placed about WGS84
                // ellipsoid level.


                //NOTE: WebXR coordinate system: 
                // right handed,
                // X to the right
                // Y to up
                // Z outwards from the screen

                

                

                // NOTE: gl-matrix has weird notation order for operations
                // if you want output = matrixB * matrixA, 
                // then you need to write mat.multiply(output, matrixA, matrixB);

                // NOTE:
                //Tcam2model = Tgeo2model *  Tpic2geo * Tcam2pic
                //Tcam2model = Tgeo2model *  inv(Tgeo2pic) * Tcam2pic
                //conceptually it should read the other way round: Tcam2model = Tcam2pic * Tpic2geo * Tgeo2model 
                
                
                /*
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
                */

                //////////////////
/*
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
                vec3.add(localObjectPosition, localCameraPosition, relativePosition)

                let localCameraOrientation = quat.create();
                mat4.getRotation(localCameraOrientation, localImagePoseMat4);
                let localObjectOrientation = quat.create();
                quat.multiply(localObjectOrientation, relativeOrientation, localCameraOrientation);

                console.log("localObjectPosition:");
                console.log(localObjectPosition);
                console.log("localObjectOrientation:");
                console.log(localObjectOrientation);

                //placeholder.setLocalRotation(localObjectOrientation;
                //placeholder.setLocalPosition(localObjectPosition);
                placeholder.setPosition(localObjectPosition[0], localObjectPosition[1], localObjectPosition[2]); // from vec3 to Vec3
//                placeholder.setRotation(localObjectOrientation[0], localObjectOrientation[1], localObjectOrientation[2], localObjectOrientation[3]); // from quat to Quat
                // TODO: local or global rotation??
                //placeholder.translate(localObjectPosition);
                //console.log("object's local transform:");
                //console.log(placeholder.getLocalTransform());
*/

                console.log("placeholder " + record.content.id + "\n" +
                        "  position (" + placeholder.getPosition().x + ", " + placeholder.getPosition().y + ", " +  placeholder.getPosition().z + ") \n" +
                        "  orientation (" + placeholder.getEulerAngles().x +  ", " + placeholder.getEulerAngles().y + ", " +  placeholder.getEulerAngles().z + ")");
                //app.root.addChild(placeholder);
            }
        });

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

    #trackinglostindicator {
        position: absolute;
        right: 10px;
        bottom: 10px;

        width: 2em;
        height: 2em;

        background-color: red;

        border-radius: 50%;
    }
</style>


<canvas id='application' bind:this={canvas}></canvas>
<aside bind:this={overlay} on:beforexrselect={(event) => event.preventDefault()}>
    {#if showFooter || hasLostTracking}
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

            {#if hasLostTracking}
                <div id="trackinglostindicator"></div>
            {/if}
        </footer>
    {/if}
</aside>
