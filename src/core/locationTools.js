/*
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
*/

/*
    Utility function helping with calculations around GeoPose.
 */

import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
import { quat, vec3 } from 'gl-matrix';


export const toRadians = (degrees) => degrees * Math.PI / 180;
export const toDegrees = (radians) => radians / Math.PI / 180;


/*
    To prevent constant localisation during development.
 */
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
                        "latitude": 8.545727117939203,
                        "longitude": 48.75619913985165,
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
                        "latitude": 8.545694856385769,
                        "longitude": 48.75619800176131,
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
    return {x:xValue, y:0.0, z:-yValue};
}


/**
 * Calculates the distance between two quaternions.
 *
 * Used to calculate the difference between the device rotation at the moment of localisation of the local and
 * global poses.
 *
 * @param localisationQuaternion  Quaternion        Rotation
 * @param localQuaternion
 * @returns {[x,y,z]}
 */
export function calculateRotation(localisationQuaternion, localQuaternion) {
    const lQuat = quat.fromValues(localisationQuaternion[0], localisationQuaternion[1], localisationQuaternion[2], localisationQuaternion[3]);
    const oQuat = quat.fromValues(localQuaternion.x, localQuaternion.y, localQuaternion.z, localQuaternion.w);

    const rotation = vec3.create();
    quat.multiply(rotation, lQuat, oQuat);

    return rotation;
}
