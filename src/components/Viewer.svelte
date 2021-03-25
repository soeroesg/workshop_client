<!--
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
-->

<!--
    Initializes and runs the AR session. Configuration will be according the data provided by the parent.
-->
<script>
    import { createEventDispatcher } from 'svelte';

    import '@thirdparty/playcanvas.dbg.js';
    import {v4 as uuidv4} from 'uuid';

    import { sendRequest, objectEndpoint, validateRequest } from 'gpp-access';
    import GeoPoseRequest from 'gpp-access/request/GeoPoseRequest.js';
    import ImageOrientation from 'gpp-access/request/options/ImageOrientation.js';
    import { IMAGEFORMAT } from 'gpp-access/GppGlobals.js';

    import { initialLocation, availableContentServices, currentMarkerImage,
        currentMarkerImageWidth, recentLocalisation,
        debug_appendCameraImage, debug_showLocalAxes, debug_useExistingPhoto, debug_useLocalServerResponse} from '@src/stateStore';
    import { wait, ARMODES, debounce } from "@core/common";
    import { createModel, createPlaceholder, addAxes, createObject } from '@core/modelTemplates';
    import { calculateDistance, fakeLocationResult, calculateRotation, getColorForContentId } from '@core/locationTools';
    import { initCameraCaptureScene, drawCameraCaptureScene, createImageFromTexture } from '@core/cameraCapture';
    import ArCloudOverlay from "@components/dom-overlays/ArCloudOverlay.svelte";
    import ArMarkerOverlay from "@components/dom-overlays/ArMarkerOverlay.svelte";

    import {mat4, vec4, mat3, vec3, quat} from 'gl-matrix';
    import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
    
    
    export let activeArMode;


    const message = (msg) => console.log(msg);

    // Used to dispatch events to parent
    const dispatch = createEventDispatcher();

    let canvas, overlay;

    let app;

    let doCaptureImage = false;
    let showFooter = false, firstPoseReceived = false, isLocalizing = false, isLocalized = false, hasLostTracking = false;

    let xrRefSpace = null, gl = null, glBinding = null;
    let trackedImage, trackedImageObject;
    let poseFoundHeartbeat = null;

    let existingPhoto = null; // A photo that we can load from file or a URL for testing the localization service. TOTO: spceify URL on the Dashboard
    // TODO: Setup event target array, based on info received from SCD


    /**
     * Setup default content of scene that should be created when WebXR reports the first successful pose
     */
    $: {
        if (firstPoseReceived) {
            if ($debug_showLocalAxes) {
                // TODO: Don't provide app to function. Return objects and add them here to the scene
                addAxes(app);
            }
        }
    }


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
            firstPoseReceived = false;
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

        if ($debug_showLocalAxes) {
            addAxes(app);
        }

        return camera.camera;
    }

    /**
     * Receives data from the application to be applied to current scene.
     */
    export function updateReceived(data) {
        console.log('viewer update received');

        // TODO: Set the data to the respective objects
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
    async function startLocalisation() {
        if ($debug_useExistingPhoto) {
            existingPhoto = await loadExistingPhoto();
        }

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
                firstPoseReceived = true;
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

    async function loadExistingPhoto() {
        // TODO: also read EXIF entries
        
        let url = "/photos/IMG_20210317_095724_hdr.jpg"; // looking at house front from the right side from sidewards angle, landscape
        //let url = "/photos/IMG_20210317_132655_hdr_small.jpg"; // from window looking down to street, landscape
        //let url = "/photos/IMG_20210321_161405_small.jpg"; // looking roughly towards North, slightly up
        //let url = "/photos/IMG_20210317_095716_hdr_small.jpg"; // looking at house front from the right side from sidewards angle, portrait
        
        let response = await fetch(url);
        let buffer = await response.arrayBuffer();
        const imageBase64 = 'data:image/jpeg;base64,' + btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        return imageBase64;
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
                // TODO: set ImageOrientation in the request
                // EXIF orientation values are listed here: https://www.impulseadventure.com/photo/exif-orientation.html
                // NOTE from Sergey:
                // The "ImageOrientation" field is used now in the OSCP geopose protocol.
                // You should use integer values [0,90,180,270] - сlockwise camera rotation, according to the usual mobile sensor. The output camera pose should depend on it.

                let image = createImageFromTexture(gl, cameraTexture, viewport.width, viewport.height);
                
                if ($debug_useExistingPhoto) {
                    image = existingPhoto; // overwrite image with existing photo
                }

                if ($debug_appendCameraImage) {
                    // DEBUG: see whether the image was captured correctly, append it to the dashboard
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
                        wait(1000).then(() => showFooter = false);

                        /*
                        // TODO: handle localization failure from AC, an example fail answer is this:
                        {
                            "code": 550,
                            "id": "9089876676575754",
                            "timestamp": "2021-03-22 01:57:09.249796",
                            "type": "geopose",
                            "name": "Localization error",
                            "description": "Fail to localize image"
                        }
                        */

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
        
        // WARNING: in the next step, change of coordinate axes might be necessary to match WebGL coordinate system
        //return vec3.fromValues(dx, dz, -dy);
        return vec3.fromValues(dx, dy, dz); // do not change axes yet
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
    function printQuat(name, x, y, z, w) {
        // With PlayCanvas Quat
        let qQuat = new pc.Quat(x, y, z, w);
        let qEuler = new pc.Vec3();
        qQuat.getEulerAngles(qEuler);
        console.log(name + ":")
        console.log("  Euler angles: " + qEuler.toString());
        let axis = new pc.Vec3()
        let angle = qQuat.getAxisAngle(axis);
        console.log("  axis: " + axis.toString());
        console.log("  angle: " + angle);

        // With gl-matrix quat
        //let qqat = quat.fromValues(x,y,z,w);
        //let axis = vec3.create();
        //let angle = quat.getAxisAngle(axis, qqat);
        //console.log("axis: " + vec3.str(axis));
        //console.log("angle: " + angle);
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
        
        // NOTE: 
        // The GeoPose location coordinates are in Local tangent plane approximation,
        // East-North-Up (ENU) right-handed coordinate system
        // https://en.wikipedia.org/wiki/Local_tangent_plane_coordinates
        // The GeoPose orientation is not in ENU, but in WebXR-compatibel coordinate system (Y up) !!!
 
        // The WebXR (and PlayCanvas) coordinate system has its origin where the SLAM started,
        // and uses a Y up right-handed coordinate system.

        // We receive the GeoPose of the camera and the GeoPoses of objects, plus the local pose of the camera in the SLAM coordinate system.
        // We want to place the objects in the SLAM coordinate system, and for that the basic idea is the following:
        // 1. calculate the relative translation between camera and object, in Geo coordinate system
        // 2. convert translation from Geo (right handed, Z up) to WebXR/PlayCanvas (right handed, Y up).
        // 3. calculate the relative rotation between the camera in local and the camera in Geo coordinate system (Both are given in WebGL coordinate system!)
        // 4. create a new scene node and align it with the Geo system. This represents the camera in the Geo system.
        // (unsure whether we need to take into account the photo's portrait/landscape orientation, and similary the UI orientation, and the camera sensor orientation)
        // 5. We append the relative transformation between camera and object on top the camera pose in Geo system.
        // 6. We rotate back the node to the WebGL system
        // 7. We append the node to the local camera pose.

        
        /*
        /// HACK DEBUG: delete gobal rotation, so that the blue camera box is aligned with the geo axes:
        globalPose.quaternion[0]=0;
        globalPose.quaternion[1]=0;
        globalPose.quaternion[2]=0;
        globalPose.quaternion[3]=1;
        */


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

        printQuat("local camera orientation", localPose.transform.orientation.x, localPose.transform.orientation.y, localPose.transform.orientation.z, localPose.transform.orientation.w);
        printQuat("global camera orientation", globalPose.quaternion[0], globalPose.quaternion[1], globalPose.quaternion[2], globalPose.quaternion[3]); // DO NOT SWAP axes

       
        // TODO: better name: deltaRotArInGeo, or slamOrientationInGeo
        let deltaRotAr2Geo = calculateRotation(globalPose.quaternion, localPose.transform.orientation); // SLAM to Geo
        let deltaRotGeo2Ar = quat.create(); // Geo to SLAM
        quat.invert(deltaRotGeo2Ar, deltaRotAr2Geo);

        // DEBUG
        printQuat("deltaRotAr2Geo", deltaRotAr2Geo[0], deltaRotAr2Geo[1], deltaRotAr2Geo[2], deltaRotAr2Geo[3]);
        printQuat("deltaRotGeo2Ar", deltaRotGeo2Ar[0], deltaRotGeo2Ar[1], deltaRotGeo2Ar[2], deltaRotGeo2Ar[3]);

        // We add the AR Camera for visualization
        // this represents the camera in the SLAM coordinate system
        let arCamNode = new pc.Entity(); // This is a virtual node at the local camera pose where the photo was taken
        app.root.addChild(arCamNode);
        let arCamSubNode = createObject("box", new pc.Color(1,1,0, 0.5)); // yellow
        arCamSubNode.setLocalScale(0.02, 0.04, 0.06);
        arCamSubNode.setLocalPosition(0.001, 0.001, 0.001);
        arCamNode.addChild(arCamSubNode);
        arCamNode.setPosition(localPose.transform.position.x,
                                  localPose.transform.position.y,
                                  localPose.transform.position.z);
        arCamNode.setRotation(localPose.transform.orientation.x,
                                  localPose.transform.orientation.y,
                                  localPose.transform.orientation.z,
                                  localPose.transform.orientation.w);
        
        let geo2ArTransformNode = new pc.Entity();
        app.root.addChild(geo2ArTransformNode);
        geo2ArTransformNode.setPosition(0,0,0);
        geo2ArTransformNode.setRotation(0,0,0,1);
//geo2ArTransformNode.setRotation(deltaRotAr2Geo[0], deltaRotAr2Geo[1], deltaRotAr2Geo[2], deltaRotAr2Geo[3]);


        // DEBUG: place GeoPose of camera as a content entry with full orientation
        // this should appear exactly where the picture was taken, with the same orientation of the camera in the world
        const geoCamNode = createObject("box", new pc.Color(0,1,1,0.5)); // cyan
        geo2ArTransformNode.addChild(geoCamNode);
        geoCamNode.setLocalScale(0.02, 0.04, 0.06);
        let geoCamRelativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose); // will be (0,0,0)
        geoCamRelativePosition = convertGeo2WebVec3(geoCamRelativePosition); // convert from Geo to SLAM
        geoCamNode.setLocalPosition(geoCamRelativePosition[0], geoCamRelativePosition[1], geoCamRelativePosition[2]); // from vec3 to Vec3
        let geoCamOrientation = quat.fromValues(globalImagePose.quaternion[0], globalImagePose.quaternion[1], globalImagePose.quaternion[2], globalImagePose.quaternion[3]);
        geoCamNode.setLocalRotation(geoCamOrientation[0], geoCamOrientation[1], geoCamOrientation[2], geoCamOrientation[3]);
        

        // DEBUG: place GeoPose of camera as a content entry with zero orientation
        // this should appear exactly where the picture was taken, with the same orientation as the yellow arCamNode
        let geoCoordinateSystemNode = createObject("box", new pc.Color(1,1,1,0.5)); // white
        geo2ArTransformNode.addChild(geoCoordinateSystemNode);
        geoCoordinateSystemNode.setLocalScale(0.02, 0.04, 0.06);
        let geoCoordinateSystemRelativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose); // will be (0,0,0)
        geoCoordinateSystemRelativePosition = convertGeo2WebVec3(geoCoordinateSystemRelativePosition); // convert from Geo to SLAM
        geoCoordinateSystemNode.setLocalPosition(geoCoordinateSystemRelativePosition[0], geoCoordinateSystemRelativePosition[1], geoCoordinateSystemRelativePosition[2]); // from vec3 to Vec3
        geoCoordinateSystemNode.setLocalRotation(0,0,0,1);



        let cnt = 0; // TODO: remove if lining up the objects is not necessary anymore
        scr.forEach(record => {
            console.log("=== SCR ===========")

            const localPosition = localPose.transform.position; // camera
            const container = new pc.Entity();
            container.setPosition(localPosition.x, localPosition.y, localPosition.z);
            app.root.addChild(container);

            // Augmented City special path for the GeoPose. Should be just 'record.content.geopose'
            let objectPose = record.content.geopose.pose;

            console.log("global object GeoPose:");
            let globalObjectPose = record.content.geopose.pose;
            console.log(globalObjectPose);

            console.log("global object pose:");
            let globalObjectPoseMat4 = convertGeoPose2PoseMat(globalObjectPose);
            console.log(globalObjectPoseMat4);

            
            //HACK: line up objects a bit North from us along a line towards East.
            globalObjectPose.quaternion[0] = 0;
            globalObjectPose.quaternion[1] = 0;
            globalObjectPose.quaternion[2] = 0;
            globalObjectPose.quaternion[3] = 1;
            globalObjectPose.latitude = globalPose.latitude + 0.0001;
            globalObjectPose.longitude = globalPose.longitude + 0.0001 * (cnt);
            globalObjectPose.altitude = globalPose.altitude;


            // This is difficult to generalize, because there are no types defined yet.
            if (record.content.type === 'placeholder') {

                /*
                //Michael's version
                const placeholder = createPlaceholder(record.content.keywords);
                container.addChild(placeholder);
                const contentPosition = calculateDistance(globalPose, objectPose);
                placeholder.setPosition(contentPosition.x + localPosition.x,
                                        contentPosition.y + localPosition.y,
                                        contentPosition.z + localPosition.z);
                // WARNING: axis conversion not needed, because the GeoPose respones contains the orientation in WebGL-consumable system!!!
                const rotation = calculateRotation(globalPose.quaternion, localPose.transform.orientation);
                container.setRotation(rotation[0], rotation[1], rotation[2], rotation[3]);
                console.log("placeholder at: " + contentPosition.x + ", " + contentPosition.y + ", " +  contentPosition.z);
                */
                //TODO: rotate a bit more with whatever is in their GeoPose orientation
                //let qObjectRotation = pc.Quat(objectPose.quaternion[0], objectPose.quaternion[1], objectPose.quaternion[2], objectPose.quaternion[3]);

                //////////////////////

/*
                // rotate everything by how much the camera has rotated so far
                let qCam = quat.create();
                mat4.getRotation(qCam, localPose.transform.matrix);
                placeholder.setRotation(qCam);
*/
                //////////////

                const placeholder = createPlaceholder(record.content.keywords, getColorForContentId(record.content.id));
                geo2ArTransformNode.addChild(placeholder);
                let relativePosition = getRelativeGlobalPosition(globalImagePose, globalObjectPose);
                //let relativeOrientation = getRelativeGlobalOrientation(globalImagePose, globalObjectPose);
                // WARNING: change from Geo to WebGL coordinate system:
                // only convert the translation part, because the orientation is already in WebGL coordinate system
                relativePosition = convertGeo2WebVec3(relativePosition);
                //relativeOrientation = convertGeo2WebQuat(relativeOrientation); // NOT NEEDED!
                // set LOCAL transformation w.r.t parent geo2ArTransformNode
                placeholder.setLocalPosition(relativePosition[0], relativePosition[1], relativePosition[2]); // from vec3 to Vec3
                //placeholder.setLocalRotation(relativeOrientation[0], relativeOrientation[1], relativeOrientation[2], relativeOrientation[3]); // THIS IS WRONG // from quat to Quat
                // set the objects' orientation as in the GeoPose response, that is already in WebGL-consumable format:
                let globalObjectOrientation = quat.fromValues(globalObjectPose.quaternion[0], globalObjectPose.quaternion[1], globalObjectPose.quaternion[2], globalObjectPose.quaternion[3])
                placeholder.setLocalRotation(globalObjectOrientation[0], globalObjectOrientation[1], globalObjectOrientation[2], globalObjectOrientation[3]); // from quat to Quat                
                

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
                // 
                const placeholder = createPlaceholder(record.content.keywords);
                app.root.addChild(placeholder);
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
                placeholder.setRotation(localObjectOrientation[0], localObjectOrientation[1], localObjectOrientation[2], localObjectOrientation[3]); // from quat to Quat
                //console.log("object's local transform:");
                //console.log(placeholder.getLocalTransform());
*/
                //////////////////

                console.log("placeholder " + record.content.id + "\n" +
                        "  position (" + placeholder.getPosition().x + ", " + placeholder.getPosition().y + ", " +  placeholder.getPosition().z + ") \n" +
                        "  orientation (" + placeholder.getEulerAngles().x +  ", " + placeholder.getEulerAngles().y + ", " +  placeholder.getEulerAngles().z + ")");
            }

            cnt = cnt + 1;
        });
        console.log("Received in total " + cnt + " objects.");


        // rotate around the origin by the rotation that brings the SLAM system to the Geo system
        let QCur = geo2ArTransformNode.getRotation(); // Quat
        printQuat("QCur", QCur.x, QCur.y, QCur.z, QCur.w);
        let qCur = quat.fromValues(QCur.x, QCur.y, QCur.z, QCur.w);
        let qNew = quat.create();

        // SWAP AXES of relative rotation (that we calculated in Geo system) from Geo to SLAM
        //let alignment = quat.fromValues(deltaRotAr2Geo[0], deltaRotAr2Geo[2], -deltaRotAr2Geo[1], deltaRotAr2Geo[3]);
        //let alignment = quat.fromValues(deltaRotGeo2Ar[0], -deltaRotGeo2Ar[2], deltaRotGeo2Ar[1], deltaRotGeo2Ar[3]); // ??
        // NO NEED TO SWAP AXES! Quaternions are all in the WebGL space!!!
        let alignment = quat.fromValues(deltaRotGeo2Ar[0], deltaRotGeo2Ar[1], deltaRotGeo2Ar[2], deltaRotGeo2Ar[3]); // NO SWAP!!!
        quat.multiply(qNew, alignment, qCur);
        geo2ArTransformNode.setRotation(qNew[0], qNew[1], qNew[2], qNew[3]); // from quat to Quat
        
        // translate to the camera position, because we know the position of all the objects only relative to the camera
        geo2ArTransformNode.translate(localPose.transform.position.x,
                                      localPose.transform.position.y,
                                      localPose.transform.position.z);

        console.log("geo2ArTransformNode:");
        printQuat("  rotation:", geo2ArTransformNode.getRotation().x, geo2ArTransformNode.getRotation().y, geo2ArTransformNode.getRotation().z, geo2ArTransformNode.getRotation().w);
        console.log("  position: ", geo2ArTransformNode.getPosition().x, geo2ArTransformNode.getPosition().y, geo2ArTransformNode.getPosition().z);
    }
</script>


<style>
    aside footer {
        position: absolute;
        bottom: 0;

        margin: var(--ui-margin);
        padding: 0 27px;

        width: calc(100vw - 4 * var(--ui-margin));

        border: 1px solid black;
        border-radius: var(--ui-radius);
        font-size: 16px;
        font-weight: bold;
        text-align: center;

        background: #FFFFFF 0% 0% no-repeat padding-box;

        opacity: 0.7;
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
    <!--  Space for UI elements  -->
    {#if showFooter}
        <footer>
            {#if activeArMode === ARMODES.oscp}
                <ArCloudOverlay hasPose="{firstPoseReceived}" isLocalizing="{isLocalizing}" isLocalized="{isLocalized}"
                        on:startLocalisation={startLocalisation} />
            {:else if activeArMode === ARMODES.marker}
                <ArMarkerOverlay />
            {:else}
                <p>Somethings wrong...</p>
                <p>Apologies.</p>
            {/if}
        </footer>
    {/if}

    {#if hasLostTracking}
        <div id="trackinglostindicator"></div>
    {/if}
</aside>
