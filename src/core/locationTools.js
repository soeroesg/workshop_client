/*
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
*/

/*
    Utility function helping with calculations around GeoPose.
 */

import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
import {mat4, vec4, mat3, vec3, quat} from 'gl-matrix';
import * as h3 from "h3-js";
import { supportedCountries } from 'ssd-access';
import "@thirdparty/playcanvas.min.js"; // for pc.Color

export const toRadians = (degrees) => degrees / 180 * Math.PI;
export const toDegrees = (radians) => radians / Math.PI * 180;


/*
* @param name  name to print
* @param qquat quat from gl-matrix packagw
*/
export function printGlmQuat(name, qquat) {
    console.log(name + ":")
    let axis = vec3.create();
    let angle = quat.getAxisAngle(axis, qquat);
    console.log("  values: x: " + qquat[0] + ", y: "+ qquat[1] + ", z: "+ qquat[2] + ", w: "+ qquat[3]);
    console.log("  axis: " + vec3.str(axis) + ", angle: " + angle);

    let euler = vec3.create();
    getEuler(euler, qquat);
    console.log("  MV Euler angles (rad): " +  vec3.str(euler));
    console.log("  MV Euler angles: " +  toDegrees(euler[0]) + ", "+  toDegrees(euler[1]) + ", "+  toDegrees(euler[2]));

    // With PlayCanvas Quat
    let qQuat = new pc.Quat(qquat[0], qquat[1], qquat[2], qquat[3]);
    let qEuler = new pc.Vec3();
    qQuat.getEulerAngles(qEuler);
    console.log("  PlayCanvas Euler angles: " + qEuler.toString());
    let pcAxis = new pc.Vec3()
    let pcAngle = qQuat.getAxisAngle(pcAxis);
    console.log("  PlayCanvas axis: " + pcAxis.toString() + ", angle (deg): " + pcAngle);
}
export function printQuat(name, x, y, z, w) {
    // With gl-matrix quat
    let qquat = quat.fromValues(x,y,z,w);
    printGlmQuat(name, qquat);
}

/**
 *  Promise resolving to the current location (lat, lon) and region code (country currently) of the device.
 *
 * @returns {Promise<LOCATIONINFO>}     Object with lat, lon, regionCode or rejects
 */
export function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                const latAngle = position.coords.latitude;
                const lonAngle = position.coords.longitude;

                fetch(`https://nominatim.openstreetmap.org/reverse?
                        lat=${latAngle}&lon=${lonAngle}&format=json&zoom=1&email=info%40michaelvogt.eu`)
                    .then((response) => {
                        if (response.ok) {
                            return response.json();
                        } else {
                            reject(response.text());
                        }
                    })
                    .then((data) => {
                        const countryCode = data.address.country_code;
                        resolve({
                            h3Index: h3.geoToH3(latAngle, lonAngle, 8),
                            lat: latAngle,
                            lon: lonAngle,
                            countryCode: countryCode,
                            regionCode: supportedCountries.includes(countryCode) ? countryCode : 'us'
                        })
                    })
                    .catch((error) => {
                        reject(error.statusText());
                    });
            }, (error) => {
                console.log(`Location request failed: ${error}`)
                reject(error);
            }, {
                enableHighAccuracy: false,
                maximumAge: 0
            });
        } else {
            reject('Location is not available');
        }
    });
}

/**
 *  Calculates the relative distance of two geodesic locations.
 *
 *  Used to calculate the relative distance between the device location at the moment of localisation and the
 *  location of an object as received from content discovery service.
 *
 * @param localisationPose  XRPose      Local pose provided by the XRSession for the latest localisation
 * @param objectPose  GeoPose       Global position as provided by a request to a Spatial Content Discovery server
 * @returns {[x,y,z]}      Local location of the global GeoPose relative to the provided local pose
 */
export function calculateDistance(localisationPose, objectPose) {
    const centerPoint = new LatLon(localisationPose.latitude, localisationPose.longitude);
    const latDiff = new LatLon( objectPose.latitude, localisationPose.longitude );
    const lonDiff = new LatLon( localisationPose.latitude, objectPose.longitude );

    const xValue = centerPoint.distanceTo(lonDiff);
    const yValue = centerPoint.distanceTo(latDiff);
    // OLD AugmentedCity API
    //const zValue = objectPose.altitude - localisationPose.altitude; 
    // NEW AugmentedCty API
    const zValue = objectPose.ellipsoidHeight - localisationPose.ellipsoidHeight;

    // TODO: Add y-value when receiving valid height value from GeoPose service
    // Ground plane for geodesic values is x/y, for 3D it's x/-z
    return {x:xValue, y:zValue, z:-yValue};
}


/**
 * Calculates the distance between two quaternions.
 *
 * Used to calculate the difference between the device rotation at the moment of localisation of the local and
 * global poses.
 *
 * @param localisationQuaternion  Quaternion        Rotation returned by a GeoPose service after localisation (Array)
 * @param localQuaternion  Quaternion       Rotation reported from WebGL at the moment localisation was started
 * @returns {{x, y, z, w}}
 */
export function calculateRotation(localisationQuaternion, localQuaternion) {
    const global = quat.fromValues(localisationQuaternion[0], localisationQuaternion[1], localisationQuaternion[2], localisationQuaternion[3]);
    const local = quat.fromValues(localQuaternion.x, localQuaternion.y, localQuaternion.z, localQuaternion.w);

    const localInv = quat.create();
    quat.invert(localInv, local);

    const diff = quat.create();
    quat.multiply(diff, global, localInv);

    const norm = quat.create();
    quat.normalize(norm, diff);
    return norm;
}


/**
 * Calculates the distance between two quaternions.
 *
 * Used to calculate the difference between the device rotation at the moment of localisation of the local and
 * global poses.
 *
 * @param localisationQuaternion  Quaternion        Rotation returned by a GeoPose service after localisation (Array)
 * @param localQuaternion  Quaternion       Rotation reported from WebGL at the moment localisation was started
 * @returns {{x, y, z}}
 */
export function calculateEulerRotation(localisationQuaternion, localQuaternion) {
    const diff = calculateRotation(localisationQuaternion, localQuaternion);

    const euler = vec3.create();
    getEuler(euler, diff);
    return euler;
}

/**
 * Returns an euler angle representation of a quaternion.
 *
 * Taken from gl-matrix issue #329. Will be remove when added to gl-matrix
 *
 * @param  {vec3} out Euler angles, pitch-yaw-roll
 * @param  {quat} mat Quaternion
 * @return {vec3} out
 */
function getEuler(out, quat) {
    let x = quat[0],
        y = quat[1],
        z = quat[2],
        w = quat[3],
        x2 = x * x,
        y2 = y * y,
        z2 = z * z,
        w2 = w * w;
    let unit = x2 + y2 + z2 + w2;
    let test = x * w - y * z;
    if (test > 0.499995 * unit) { //TODO: Use glmatrix.EPSILON
        // singularity at the north pole
        out[0] = Math.PI / 2;
        out[1] = 2 * Math.atan2(y, x);
        out[2] = 0;
    } else if (test < -0.499995 * unit) { //TODO: Use glmatrix.EPSILON
        // singularity at the south pole
        out[0] = -Math.PI / 2;
        out[1] = 2 * Math.atan2(y, x);
        out[2] = 0;
    } else {
        out[0] = Math.asin(2 * (x * z - w * y));
        out[1] = Math.atan2(2 * (x * w + y * z), 1 - 2 * (z2 + w2));
        out[2] = Math.atan2(2 * (x * y + z * w), 1 - 2 * (y2 + z2));
    }
    // TODO: Return them as degrees and not as radians
    return out;
}

export function convertGeo2WebVec3(geoVec3) {
    let webVec3 = vec3.fromValues(geoVec3[0], geoVec3[2], -geoVec3[1]);
    return webVec3;
}

export function convertWeb2GeoVec3(webVec3) {
    let geoVec3 = vec3.fromValues(webVec3[0], -webVec3[2], webVec3[1]);
    return geoVec3;
}

export function convertGeo2WebQuat(geoQuat) {
    // WebXR: X to the right, Y up, Z backwards
    // Geo East-North-Up: X to the right, Y forwards, Z up
    let webQuat = quat.fromValues(geoQuat[0], geoQuat[2], -geoQuat[1], geoQuat[3]);
    return webQuat;
}

export function convertWeb2GeoQuat(webQuat) {
    let geoQuat = vec3.fromValues(webQuat[0], -webQuat[2], webQuat[1], webQuat[3]);
    return geoQuat;
}

export function convertGeoPose2PoseMat(globalPose) {
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
export function getRelativeGlobalPosition(cameraGeoPose, objectGeoPose) {
    // first method, Geo
    const cam = new LatLon(cameraGeoPose.latitude, cameraGeoPose.longitude);
    const cam2objLat = new LatLon(objectGeoPose.latitude, cameraGeoPose.longitude);
    const cam2objLon = new LatLon(cameraGeoPose.latitude, objectGeoPose.longitude);
    const dx = cam.distanceTo(cam2objLon);
    const dy = cam.distanceTo(cam2objLat);
    
    // OLD AugmentedCity API
    //const dz = objectGeoPose.altitude - cameraGeoPose.altitude; 
    // NEW AugmentedCty API
    const dz = objectGeoPose.ellipsoidHeight - cameraGeoPose.ellipsoidHeight;
    console.log("dx: " + dx + ", dy: " + dy + ", dz: " + dz);

    // WARNING: AugmentedCity sometimes returns invalid height!
    // Therefore we set dz to 0
    if (isNaN(dz)) {
        console.log("WARNING: dz is not a number");
        dz = 0.0;
    }
    
    // WARNING: in the next step, change of coordinate axes might be necessary to match WebGL coordinate system
    //return vec3.fromValues(dx, dz, -dy);
    return vec3.fromValues(dx, dy, dz); // do not change axes yet
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
export function getRelativeGlobalOrientation(cameraGeoPose, objectGeoPose) {
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
