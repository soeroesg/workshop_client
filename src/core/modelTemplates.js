/*
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
*/

/* Provides models for generic content, provided by the content discovery */

import "@thirdparty/playcanvas.min.js";

/**
 * Simple sample model to place for tests.
 *
 * @returns {Entity}
 */
export function createModel() {
    const cube = new pc.Entity();
    cube.addComponent("model", {type: "box"});
    cube.setLocalScale(0.1, 0.1, 0.1);
    cube.setLocalPosition(-0.25, 0.0, 0.0);
    return cube;
}


/**
 * Simple sample model to place for tests.
 * @param type string, any of the following: box, capsule, cone, cylinder, plane, sphere
 * @param color Color, example  new pc.Color(1,0,0);
 * @returns {Entity}
 */
 export function createObject(type, color) {
    let entity = new pc.Entity();
    entity.addComponent("model", {type: type});
    entity.setLocalScale(0.1, 0.1, 0.1);
    //entity.model.material = new pc.StandardMaterial();
    //entity.model.material.diffuse.set(color);
    //entity.model.material.specular.set(1, 1, 1);
    //entity.model.material.update();
    return entity;
}

/**
 * A directional light.
 * @returns {Entity}
 */
function createLight() {
    // Add a pc.LightComponent to an entity
    let entity = new pc.Entity();
    entity.addComponent('light', {
        type: "directional", // directional, point, spot
        color: new pc.Color(1, 1, 1)
    });
    return entity;
}



/**
 * Creates a model for content type 'placeholder', based on optionally provided keywords.
 *
 * Positioning of the model needs to be done by the caller.
 *
 * @param keywords      string, provided by a call to a Spatial Content Discovery server
 * @returns {Entity}
 */
export function createPlaceholder(keywords) {
    const placeholder = new pc.Entity();
    placeholder.addComponent('model', {type: 'box'});
    placeholder.setLocalScale(0.1, 0.2, 0.3);
    return placeholder;
}