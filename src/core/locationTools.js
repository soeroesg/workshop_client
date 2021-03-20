/*
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
*/

/*
    Utility function helping with calculations around GeoPose.
 */

import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
import { quat, vec3 } from 'gl-matrix';
import * as h3 from "h3-js";
import { supportedCountries } from 'ssd-access';

export const toRadians = (degrees) => degrees / 180 * Math.PI;
export const toDegrees = (radians) => radians / Math.PI * 180;

/*
// Michael
// To prevent constant localisation during development.
export const fakeLocationResult = {
    "geopose": {
        "accuracy": {
            "orientation": -1,
            "position": -1
        },
        "ecef": {
            "quaternion": [
                0.1688532109050503,
                0.19756124943500367,
                0.9382665436004023,
                0.2282849952337845
            ],
            "x": 4166093.940304932,
            "y": 626020.2177832468,
            "z": 4772721.929407399
        },
        "id": "077e784f-39bb-478c-a506-62ea66d97b38",
        "pose": {
            "altitude": 0.0945550863688725,
            "ellipsoidHeight": -1,
            "latitude": 48.756116769726326,
            "longitude": 8.54564270789997,
            "quaternion": [
                0.15371682997261205,
                0.34355991619394605,
                0.06724257876108236,
                -0.9240217290570278
            ]
        },
        "timestamp": "Fri, 12 Mar 2021 14:12:25 GMT",
        "type": "geopose"
    },
    "scrs": [
        {
            "content": {
                "description": "",
                "geopose": {
                    "ecef": {
                        "quaternion": [
                            0.830623522215871,
                            -0.10786157126364478,
                            0.41119252332211725,
                            0.35965421525435926
                        ],
                        "x": 4166085.983913865,
                        "y": 626025.2984149567,
                        "z": 4772727.71094573
                    },
                    "pose": {
                        "altitude": -0.2476527839899063,
                        "ellipsoidHeight": -1,
                        "latitude": 48.75619913985165,
                        "longitude": 8.545727117939203,
                        "quaternion": [
                            0.6316581032678967,
                            -0.3041746084477361,
                            0.29620619260700987,
                            0.6486507069393577
                        ]
                    }
                },
                "id": "25357",
                "keywords": [
                    "place"
                ],
                "refs": [
                    {
                        "contentType": "",
                        "url": ""
                    }
                ],
                "title": "first",
                "type": "placeholder",
                "url": ""
            },
            "id": "25357",
            "tenant": "AC",
            "timestamp": "2021-03-12T14:12:25.511103",
            "type": "scr"
        },
        {
            "content": {
                "description": "",
                "geopose": {
                    "ecef": {
                        "quaternion": [
                            0.17137860514440476,
                            -0.2931957566278503,
                            0.15738794731222638,
                            0.927305050150718
                        ],
                        "x": 4166086.5564877656,
                        "y": 626022.9856858315,
                        "z": 4772727.772796178
                    },
                    "pose": {
                        "altitude": -0.05442802235484123,
                        "ellipsoidHeight": -1,
                        "latitude": 48.75619800176131,
                        "longitude": 8.545694856385769,
                        "quaternion": [
                            0.10833754747430582,
                            -0.7679511427475457,
                            0.6166956411000059,
                            0.13490924508069949
                        ]
                    }
                },
                "id": "25358",
                "keywords": [
                    "place"
                ],
                "refs": [
                    {
                        "contentType": "",
                        "url": ""
                    }
                ],
                "title": "parkplatz",
                "type": "placeholder",
                "url": ""
            },
            "id": "25358",
            "tenant": "AC",
            "timestamp": "2021-03-12T14:12:25.696754",
            "type": "scr"
        }
    ]
}
*/

// Gabor
export const fakeLocationResult = {
    "geopose": {
        "accuracy": {
            "orientation": -1,
            "position": -1
        },
        "ecef": {
            "quaternion": [
                -0.398823673930705171,
                0.041021405375489552,
                0.66377704179966283,
                0.631392873093388
            ],
            "x": 4083564.3907412677,
            "y": 1408077.3625542116,
            "z": 4677083.13785787
        },
        "id": "d4c46372-6d28-49be-83fd-653b5c99b81b",
        "pose": {
            "altitude": 6.439214337116371,
            "ellipsoidHeight": -1,
            "latitude": 47.46780006133321,
            "longitude": 19.025000497036224,
            "quaternion": [
                -0.56045581742076441,
                -0.72083617469938812,
                0.16772594092733553,
                0.3716887067211158
            ]
        },
        "timestamp": "Wed, 17 Mar 2021 19:00:38 GMT",
        "type": "geopose"
    },
    "scrs": [
        {
            "content": {
                "description": "",
                "geopose": {
                    "ecef": {
                        "quaternion": [
                            -0.28567446380652645,
                             0.18366812440038047,
                            -0.3602877743027662,
                             0.8688203729747938
                        ],
                        "x": 4083566.9818944046,
                        "y": 1408064.9004089904,
                        "z": 4677073.947148238
                    },
                    "pose": {
                        "altitude": -1.42364501953125,
                        "ellipsoidHeight": -1,
                        "latitude": 47.46775486879815,
                        "longitude": 19.024833019394446,
                        "quaternion": [
                            -0.05238614875722129,
                            -0.8257331266006536,
                             0.07777061225652594,
                            -0.5562123937147937
                        ]
                    }
                },
                "id": "25395",
                "keywords": [
                    "other"
                ],
                "refs": [
                    {
                        "contentType": "",
                        "url": ""
                    }
                ],
                "title": "ELMU",
                "type": "placeholder",
                "url": "www.elmu.hu"
            },
            "id": "25395",
            "tenant": "AC",
            "timestamp": "2021-03-17T19:00:38.900368",
            "type": "scr"
        },
        {
            "content": {
                "description": "",
                "geopose": {
                    "ecef": {
                        "quaternion": [
                             0.39872507335659046,
                           -0.03012194875260205,
                             0.836933833311131,
                            -0.3737014085326188
                        ],
                        "x": 4083567.681876626,
                        "y": 1408083.7531147094,
                        "z": 4677070.674950173
                    },
                    "pose": {
                        "altitude": 0.766888439655304,
                        "ellipsoidHeight": -1,
                        "latitude": 47.467689854053496,
                        "longitude": 19.025066403025875,
                        "quaternion": [
                            -0.038424859835383816,
                            -0.249253946378255,
                            -0.005164122058755353,
                            -0.9676617729967766
                        ]
                    }
                },
                "id": "25394",
                "keywords": [
                    "other"
                ],
                "refs": [
                    {
                        "contentType": "",
                        "url": ""
                    }
                ],
                "title": "trans2tank",
                "type": "placeholder",
                "url": "3dobject"
            },
            "id": "25394",
            "tenant": "AC",
            "timestamp": "2021-03-17T19:00:38.698824",
            "type": "scr"
        }
    ]
    
        
    //0: content: description: ""geopose: ecef: quaternion: (4) [0.08448442637121957, 0.38609012181486335, 0.7667728040540936, 0.5058223665485075]x: 4083552.3772353483y: 1408073.2647693662z: 4677090.279360294__proto__: Objectpose: altitude: 3.121204376220703ellipsoidHeight: -1latitude: 19.025001057084904longitude: 47.46792761293988quaternion: Array(4)0: 0.107992391124264271: 0.71622420038524062: 0.113742386840596913: -0.6800170642547072length: 4__proto__: Array(0)__proto__: Object__proto__: Objectid: "25307"keywords: ["text"]refs: Array(1)0: {contentType: "", url: ""}length: 1__proto__: Array(0)title: "Frakno utca 23"type: "placeholder"url: ""__proto__: Objectid: "25307"tenant: "AC"timestamp: "2021-03-17T19:00:38.312116"type: "scr"__proto__: Object
    
    //1: content: description: ""geopose: ecef: quaternion: Array(4)0: 0.12957777565797271: -0.181285577746382132: 0.22987577291745113: 0.9473659632804511length: 4__proto__: Array(0)x: 4083568.365709138y: 1408068.4946531407z: 4677073.177534068__proto__: Objectpose: altitude: -0.3143647015094757ellipsoidHeight: -1latitude: 19.024872107274113longitude: 47.46773375281895quaternion: Array(4)0: 0.065561787843923521: -0.83260073190799582: 0.54063207603953533: 0.10096846813812742length: 4__proto__: Array(0)__proto__: Object__proto__: Objectid: "25308"keywords: ["text"]refs: Array(1)0: {contentType: "", url: ""}length: 1__proto__: Array(0)title: "Garage"type: "placeholder"url: ""__proto__: Objectid: "25308"tenant: "AC"timestamp: "2021-03-17T19:00:38.511519"type: "scr"__proto__: Object
    
    /*
    2: content: description: ""geopose: ecef: quaternion: Array(4)0: 0.398725073356590461: -0.030121948752602052: 0.8369338333111313: -0.3737014085326188length: 4__proto__: Array(0)x: 4083567.681876626y: 1408083.7531147094z: 4677070.674950173__proto__: Object
    pose: altitude: 0.766888439655304ellipsoidHeight: -1latitude: 19.025066403025875longitude: 47.467689854053496quaternion: Array(4)0: -0.0384248598353838161: -0.2492539463782552: -0.0051641220587553533: -0.9676617729967766length: 4__proto__: Array(0)__proto__: Object__proto__: Object
    id: "25394"keywords: Array(1)0: "other"length: 1__proto__: Array(0)refs: Array(1)0: {contentType: "", url: ""}length: 1__proto__: Array(0)
    title: "trans2tank"type: "placeholder"url: "3dobject"__proto__: Objectid: "25394"tenant: "AC"timestamp: "2021-03-17T19:00:38.698824"type: "scr"__proto__: Object
    */

    /*
    3: content: description: ""geopose: 
    ecef: quaternion: Array(4)0: -0.285674463806526451: 0.183668124400380472: -0.36028777430276623: 0.8688203729747938length: 4__proto__: Array(0)x: 4083566.9818944046y: 1408064.9004089904z: 4677073.947148238__proto__: Object
    pose: altitude: -1.42364501953125ellipsoidHeight: -1latitude: 19.024833019394446longitude: 47.46775486879815quaternion: Array(4)0: -0.052386148757221291: -0.82573312660065362: 0.077770612256525943: -0.5562123937147937length: 4__proto__: Array(0)__proto__: Object__proto__: Object
    id: "25395"
    keywords: ["other"]
    refs: [{…}]
    title: "ELMU"
    type: "placeholder"
    url: "www.elmu.hu"__proto__: Object
    id: "25395"
    tenant: "AC"
    timestamp: "2021-03-17T19:00:38.900368"
    type: "scr"__proto__: Objectlength: 4__proto__: Array(0)__proto__: Object
    */
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

    // TODO: Add y-value when receiving valid height value from GeoPose service
    // Ground plane for geodesic values is x/y, for 3D it's x/-z
    return {x:xValue, y:0.0, z:-yValue};
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
    quat.invert(localInv , global);

    const diff = quat.create();
    quat.multiply(diff , global, localInv);

    return diff;
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