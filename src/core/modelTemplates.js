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


/**
 * Add axes at the zero point of the local coordinate system.
 *
 * @param app  Application      Playcanvas camera access point
 */
export function addAxes(app) {
    // TODO: add the objects in an entity and return them, don't add them here to the scene

    // add something small at the positive X, Y, Z:
    const objX = createObject("box", new pc.Color(1, 0, 0));
    objX.setPosition(1, 0, 0);
    app.root.addChild(objX);

    const objY = createObject("sphere", new pc.Color(0, 1, 0));
    objY.setPosition(0, 1, 0);
    app.root.addChild(objY);

    const objZ = createObject("cone", new pc.Color(0, 0, 1));
    objZ.setPosition(0, 0, 1);
    app.root.addChild(objZ);

    const obj0 = createObject("box", new pc.Color(1, 0, 0));
    obj0.setLocalScale(0.01, 0.01, 0.01);
    obj0.setPosition(0, 0, 0);
    app.root.addChild(obj0);
}

export function addLogo(app) {

  // Load a model file and create a Entity with a model component
  var url = "assets/oarc/logo.glb";
  app.assets.loadFromUrl(url, "container", function (err, asset) {
       if (err != null) {
          console.log(err);
      }
      if (asset === undefined) {
          return;
      }
      

      let logo = new pc.Entity('logo');
      logo.setLocalScale(0.1, 0.1, 0.1); // an extra scaling
      logo.setPosition(0,0,0);
      app.root.addChild(logo);

      var entity = new pc.Entity();
      entity.addComponent("model", {
          type: "asset",
          asset: asset.resource.model,
          castShadows: true
      });
      app.root.findByName("logo").addChild(entity)
      //app.root.addChild(entity);
  });
}

/**
* A directional light.
* @returns {Entity}
*/
export function addLight(app) {
    // Add a pc.LightComponent to an entity
    let entity = new pc.Entity();
    entity.addComponent('light', {
        type: "directional", // directional, point, spot
        color: new pc.Color(1, 1, 1)
    });

    app.root.addChild(entity);
}

/**
 * Helper for 3D object creation.
 *
 * @param type  String      One of the supported object types
 * @param color  Color      Playcanvas color object
 * @returns {Entity}
 */
export function createObject(type, color) {
    const entity = new pc.Entity();
    entity.addComponent("model", {type: type});
    entity.setLocalScale(0.1, 0.1, 0.1);

    if (color) {
        const material = new pc.StandardMaterial();
        material.diffuse = color;
        material.update();

        entity.model.material = material;
    }
    return entity;
}