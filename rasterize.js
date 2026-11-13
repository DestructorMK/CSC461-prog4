
const INPUT_TRIANGLES_URL = "https://ncsucgclass.github.io/prog4/triangles.json";
const INPUT_LIGHTS_URL    = "https://ncsucgclass.github.io/prog4/lights.json";
const TEXTURE_BASE_URL    = "https://ncsucgclass.github.io/prog4/";
const MAX_LIGHTS = 8; // most lights the fragment shader sums

var defaultEye    = vec3.fromValues(0.5, 0.5, -0.5);
var defaultLookAt = vec3.fromValues(0, 0, 1);
var defaultUp     = vec3.fromValues(0, 1, 0);
var lights = [{
    position: [-0.5, 1.5, -0.5], ambient: [1,1,1], diffuse: [1,1,1], specular: [1,1,1]
}];

var Eye    = vec3.clone(defaultEye);
var LookAt = vec3.clone(defaultLookAt);
var Up     = vec3.clone(defaultUp);
var winLeft=-0.5, winRight=0.5, winBottom=-0.5, winTop=0.5;
var winDist=0.5, winNear=0.01, winFar=100;

const TRANSLATE_STEP = 0.02;
const ROTATE_STEP    = 2 * Math.PI / 180;
const HIGHLIGHT_SCALE = 1.2;
var selectedModel = -1;

// blendMode: 0 unlit, 1 replace, 2 modulate (default)
var blendMode = 2;

// sortMode: 0 unsorted, 1 painter's (average depth), 2 BSP (default)
var sortMode = 2;
var BLEND_NAMES = ["unlit texture", "texture replaces diffuse", "texture modulates lighting"];
var SORT_NAMES  = ["unsorted", "painter's sort", "BSP sort"];

function updateStatus() {
    var el = document.getElementById("status");
    if (el) el.textContent = "blend (b): " + BLEND_NAMES[blendMode] + "   |   transparency (, .): " + SORT_NAMES[sortMode];
}

var gl = null;
var models = [];
var textureCache = {};

var vertexPositionAttrib, vertexNormalAttrib, vertexFaceNormalAttrib, vertexUVAttrib;
var modelMatrixULoc, viewMatrixULoc, projMatrixULoc, normalMatrixULoc;
var eyePositionULoc, numLightsULoc;
var lightPositionULoc, lightAmbientULoc, lightDiffuseULoc, lightSpecularULoc;
var ambientULoc, diffuseULoc, specularULoc, shininessULoc;
var alphaULoc, blendModeULoc;
var useTextureULoc, texSamplerULoc;
var useTexture2ULoc, tex2SamplerULoc, unlitULoc, cutoutULoc;

function getJSONFile(url, descr) {
    try {
        if ((typeof(url) !== "string") || (typeof(descr) !== "string"))
            throw "getJSONFile: parameter not a string";
        var httpReq = new XMLHttpRequest();
        httpReq.open("GET", url, false);
        httpReq.send(null);
        var startTime = Date.now();
        while ((httpReq.status !== 200) && (httpReq.readyState !== XMLHttpRequest.DONE)) {
            if ((Date.now() - startTime) > 3000) break;
        }
        if ((httpReq.status !== 200) || (httpReq.readyState !== XMLHttpRequest.DONE))
            throw "Unable to open " + descr + " file!";
        return JSON.parse(httpReq.response);
    } catch(e) {
        console.log(e);
        return String.null;
    }
}

function setupWebGL() {
    var imageCanvas = document.getElementById("myImageCanvas");
    var cw = imageCanvas.width, ch = imageCanvas.height;
    var imageContext = imageCanvas.getContext("2d");
    var bkgdImage = new Image();
    bkgdImage.crossOrigin = "Anonymous";
    bkgdImage.src = "https://ncsucgclass.github.io/prog3/sky.jpg";
    bkgdImage.onload = function() {
        var iw = bkgdImage.width, ih = bkgdImage.height;
        imageContext.drawImage(bkgdImage, 0, 0, iw, ih, 0, 0, cw, ch);
    };

    var canvas = document.getElementById("myWebGLCanvas");
    gl = canvas.getContext("webgl", {alpha: true, premultipliedAlpha: false});
    try {
        if (gl == null) throw "unable to create gl context -- is your browser gl ready?";
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clearDepth(1.0);
        gl.enable(gl.DEPTH_TEST);
    } catch(e) { console.log(e); }
}

function makeArrayBuffer(values) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    return buffer;
}

function isPowerOf2(v) { return (v & (v - 1)) === 0; }

function loadTexture(url) {
    if (textureCache[url]) return textureCache[url];

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 1×1 white placeholder (avoids runtime errors while async load is pending)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([255, 255, 255, 255]));
    textureCache[url] = tex;

    var img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        if (isPowerOf2(img.width) && isPowerOf2(img.height)) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
    };
    img.src = url;
    return tex;
}

function loadTriangles() {
    var inputTriangles = getJSONFile(INPUT_TRIANGLES_URL, "triangles");
    if (inputTriangles != String.null)
        for (var w=0; w<inputTriangles.length; w++)
            addModel(inputTriangles[w]);
}

function addModel(set, texBase) {
    texBase = texBase || TEXTURE_BASE_URL;
    var coordArray = [], normalArray = [], vertexNormalArray = [], uvArray = [];
    var hasNormals = Array.isArray(set.normals) && (set.normals.length === set.vertices.length);
    var hasUVs     = Array.isArray(set.uvs)     && (set.uvs.length     === set.vertices.length);

    var center = vec3.create();
    for (var i=0; i<set.vertices.length; i++) vec3.add(center, center, set.vertices[i]);
    vec3.scale(center, center, 1 / set.vertices.length);

    var alpha = 1.0;
    if      (set.material && set.material.alpha !== undefined) alpha = set.material.alpha;
    else if (set.alpha !== undefined)                          alpha = set.alpha;

    var rawTris = [];

    for (var whichTri=0; whichTri<set.triangles.length; whichTri++) {
        var tri = set.triangles[whichTri];
        var v0 = set.vertices[tri[0]], v1 = set.vertices[tri[1]], v2 = set.vertices[tri[2]];

        var edge1 = vec3.subtract(vec3.create(), v1, v0);
        var edge2 = vec3.subtract(vec3.create(), v2, v0);
        var faceN = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), edge1, edge2));
        if (hasNormals) {
            var ns = vec3.add(vec3.create(), set.normals[tri[0]], set.normals[tri[1]]);
            vec3.add(ns, ns, set.normals[tri[2]]);
            if (vec3.dot(faceN, ns) < 0) vec3.negate(faceN, faceN);
        }

        var tCoords = [], tFaceNs = [], tVertNs = [], tUVs = [];
        var centroid = vec3.create();

        for (var c=0; c<3; c++) {
            var v   = set.vertices[tri[c]];
            var uvp = hasUVs ? set.uvs[tri[c]] : [0, 0];
            var vn  = hasNormals ? vec3.normalize(vec3.create(), set.normals[tri[c]]) : faceN;

            coordArray.push(v[0], v[1], v[2]);
            normalArray.push(faceN[0], faceN[1], faceN[2]);
            vertexNormalArray.push(vn[0], vn[1], vn[2]);
            uvArray.push(uvp[0], uvp[1]);

            tCoords.push(v[0], v[1], v[2]);
            tFaceNs.push(faceN[0], faceN[1], faceN[2]);
            tVertNs.push(vn[0], vn[1], vn[2]);
            tUVs.push(uvp[0], uvp[1]);

            vec3.add(centroid, centroid, v);
        }
        vec3.scale(centroid, centroid, 1/3);

        if (alpha < 1.0) rawTris.push({
            centroid: centroid,
            verts:    tCoords.slice(),
            vertBuf:  makeArrayBuffer(tCoords),
            normBuf:  makeArrayBuffer(tFaceNs),
            vNormBuf: makeArrayBuffer(tVertNs),
            uvBuf:    makeArrayBuffer(tUVs)
        });
    }

    var texName  = (set.material && set.material.texture)  ? set.material.texture  :
                   (set.texture  ? set.texture  : null);
    var tex2Name = (set.material && set.material.texture2) ? set.material.texture2 :
                   (set.texture2 ? set.texture2 : null);

    var texture  = texName  ? loadTexture(texBase + texName)  : null;
    var texture2 = tex2Name ? loadTexture(texBase + tex2Name) : null;

    models.push({
        vertexBuffer:       makeArrayBuffer(coordArray),
        normalBuffer:       makeArrayBuffer(normalArray),
        vertexNormalBuffer: makeArrayBuffer(vertexNormalArray),
        uvBuffer:           makeArrayBuffer(uvArray),
        vertexCount:        coordArray.length / 3,

        material: set.material || { ambient:[0.1,0.1,0.1], diffuse:[0.8,0.8,0.8], specular:[0.3,0.3,0.3], n:10 },
        alpha:    alpha,
        texture:  texture,
        texture2: texture2,
        isTransparent: (alpha < 1.0),

        unlit:  !!set.unlit,
        cutout: set.cutout || 0,
        isSky:  !!set.sky,

        center:      center,
        translation: vec3.create(),
        rotation:    mat4.create(),

        rawTris: rawTris,
    });
}

function loadLights() {
    var inputLights = getJSONFile(INPUT_LIGHTS_URL, "lights");
    if ((inputLights != String.null) && Array.isArray(inputLights) && inputLights.length > 0) {
        if (inputLights.length > MAX_LIGHTS)
            console.log("lights file has " + inputLights.length + " lights, using first " + MAX_LIGHTS);
        lights = inputLights.slice(0, MAX_LIGHTS).map(function(l) {
            return { position:[l.x,l.y,l.z], ambient:l.ambient, diffuse:l.diffuse, specular:l.specular };
        });
    }
}

function setupShaders() {

    var fShaderCode = `
        precision mediump float;

        const int MAX_LIGHTS = ${MAX_LIGHTS};
        uniform int   uNumLights;
        uniform vec3  uLightPosition[MAX_LIGHTS];
        uniform vec3  uLightAmbient [MAX_LIGHTS];
        uniform vec3  uLightDiffuse [MAX_LIGHTS];
        uniform vec3  uLightSpecular[MAX_LIGHTS];
        uniform vec3  uEyePosition;

        uniform vec3  uAmbient;
        uniform vec3  uDiffuse;
        uniform vec3  uSpecular;
        uniform float uShininess;
        uniform float uAlpha;

        uniform int   uBlendMode;
        uniform bool  uUseTexture;
        uniform bool  uUseTexture2;
        uniform bool  uUnlit;
        uniform float uCutout;
        uniform sampler2D uTexture;
        uniform sampler2D uTexture2;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vFaceNormal;
        varying vec2 vUV;

        // Blinn-Phong lighting with an arbitrary diffuse color
        vec3 phongLight(vec3 N, vec3 diffuseColor) {
            vec3 V = normalize(uEyePosition - vWorldPos);
            if (dot(vFaceNormal, V) < 0.0) N = -N;
            vec3 col = vec3(0.0);
            for (int i=0; i<MAX_LIGHTS; i++) {
                if (i >= uNumLights) break;
                vec3 L = normalize(uLightPosition[i] - vWorldPos);
                vec3 H = normalize(L + V);
                col += uAmbient    * uLightAmbient [i];
                col += diffuseColor* uLightDiffuse [i] * max(dot(N,L), 0.0);
                col += uSpecular   * uLightSpecular[i] * pow(max(dot(N,H), 0.0), uShininess);
            }
            return clamp(col, 0.0, 1.0);
        }

        void main(void) {
            vec4 texColor = uUseTexture ? texture2D(uTexture, vUV) : vec4(uDiffuse, 1.0);

            float alpha = uAlpha * (uUseTexture ? texColor.a : 1.0);

            if (uCutout > 0.0) {
                if (uUseTexture && texColor.a < uCutout) discard;
                alpha = 1.0;
            }
            if (uUnlit) { gl_FragColor = vec4(texColor.rgb * uDiffuse, alpha); return; }

            vec3 N = normalize(vNormal);
            vec3 finalColor;

            if (uBlendMode == 0) {
                finalColor = texColor.rgb;
            } else if (uBlendMode == 1) {
                vec3 d = uUseTexture ? texColor.rgb : uDiffuse;
                finalColor = phongLight(N, d);
            } else {
                vec3 lit = phongLight(N, uDiffuse);
                finalColor = uUseTexture ? lit * texColor.rgb : lit;
            }

            if (uUseTexture2) {
                vec4 lm = texture2D(uTexture2, vUV);
                finalColor *= lm.rgb;
            }

            gl_FragColor = vec4(finalColor, alpha);
        }
    `;

    var vShaderCode = `
        attribute vec3 vertexPosition;
        attribute vec3 vertexNormal;
        attribute vec3 vertexFaceNormal;
        attribute vec2 vertexUV;

        uniform mat4 uModelMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uProjMatrix;
        uniform mat3 uNormalMatrix;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vFaceNormal;
        varying vec2 vUV;

        void main(void) {
            vec4 worldPos = uModelMatrix * vec4(vertexPosition, 1.0);
            vWorldPos    = worldPos.xyz;
            vNormal      = uNormalMatrix * vertexNormal;
            vFaceNormal  = uNormalMatrix * vertexFaceNormal;
            vUV          = vertexUV;
            gl_Position  = uProjMatrix * uViewMatrix * worldPos;
        }
    `;

    try {
        var fShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fShader, fShaderCode);
        gl.compileShader(fShader);

        var vShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vShader, vShaderCode);
        gl.compileShader(vShader);

        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS))
            throw "fragment shader error: " + gl.getShaderInfoLog(fShader);
        if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS))
            throw "vertex shader error: " + gl.getShaderInfoLog(vShader);

        var prog = gl.createProgram();
        gl.attachShader(prog, fShader);
        gl.attachShader(prog, vShader);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            throw "shader link error: " + gl.getProgramInfoLog(prog);

        gl.useProgram(prog);

        vertexPositionAttrib  = gl.getAttribLocation(prog, "vertexPosition");  gl.enableVertexAttribArray(vertexPositionAttrib);
        vertexNormalAttrib    = gl.getAttribLocation(prog, "vertexNormal");    gl.enableVertexAttribArray(vertexNormalAttrib);
        vertexFaceNormalAttrib= gl.getAttribLocation(prog, "vertexFaceNormal");gl.enableVertexAttribArray(vertexFaceNormalAttrib);
        vertexUVAttrib        = gl.getAttribLocation(prog, "vertexUV");        gl.enableVertexAttribArray(vertexUVAttrib);

        modelMatrixULoc  = gl.getUniformLocation(prog, "uModelMatrix");
        viewMatrixULoc   = gl.getUniformLocation(prog, "uViewMatrix");
        projMatrixULoc   = gl.getUniformLocation(prog, "uProjMatrix");
        normalMatrixULoc = gl.getUniformLocation(prog, "uNormalMatrix");

        eyePositionULoc   = gl.getUniformLocation(prog, "uEyePosition");
        numLightsULoc     = gl.getUniformLocation(prog, "uNumLights");
        lightPositionULoc = gl.getUniformLocation(prog, "uLightPosition");
        lightAmbientULoc  = gl.getUniformLocation(prog, "uLightAmbient");
        lightDiffuseULoc  = gl.getUniformLocation(prog, "uLightDiffuse");
        lightSpecularULoc = gl.getUniformLocation(prog, "uLightSpecular");

        ambientULoc   = gl.getUniformLocation(prog, "uAmbient");
        diffuseULoc   = gl.getUniformLocation(prog, "uDiffuse");
        specularULoc  = gl.getUniformLocation(prog, "uSpecular");
        shininessULoc = gl.getUniformLocation(prog, "uShininess");
        alphaULoc     = gl.getUniformLocation(prog, "uAlpha");

        blendModeULoc   = gl.getUniformLocation(prog, "uBlendMode");
        useTextureULoc  = gl.getUniformLocation(prog, "uUseTexture");
        texSamplerULoc  = gl.getUniformLocation(prog, "uTexture");
        useTexture2ULoc = gl.getUniformLocation(prog, "uUseTexture2");
        tex2SamplerULoc = gl.getUniformLocation(prog, "uTexture2");
        unlitULoc       = gl.getUniformLocation(prog, "uUnlit");
        cutoutULoc      = gl.getUniformLocation(prog, "uCutout");

    } catch(e) { console.log(e); }
}

function getViewAxes() {
    var forward = vec3.normalize(vec3.create(), LookAt);
    var right   = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), forward, Up));
    var up      = vec3.cross(vec3.create(), right, forward);
    return { right:right, up:up, forward:forward };
}

function rotateVector(v, axis, angle) {
    vec3.transformMat4(v, v, mat4.fromRotation(mat4.create(), angle, axis));
    vec3.normalize(v, v);
}

// M = T(translation) * T(center) * R * S * T(-center)
function getModelMatrix(model, isSelected) {
    var M = mat4.create();
    var scale = isSelected ? HIGHLIGHT_SCALE : 1;
    mat4.translate(M, M, model.translation);
    mat4.translate(M, M, model.center);
    mat4.multiply(M, M, model.rotation);
    mat4.scale(M, M, [scale, scale, scale]);
    mat4.translate(M, M, vec3.negate(vec3.create(), model.center));
    return M;
}

function rotateSelection(axis, angle) {
    var turn = mat4.fromRotation(mat4.create(), angle, axis);
    mat4.multiply(models[selectedModel].rotation, turn, models[selectedModel].rotation);
}

function translateSelection(axis, amount) {
    vec3.scaleAndAdd(models[selectedModel].translation,
                     models[selectedModel].translation, axis, amount);
}

function drawModel(model, isSelected) {
    var modelMatrix = getModelMatrix(model, isSelected);
    gl.uniformMatrix4fv(modelMatrixULoc, false, modelMatrix);
    gl.uniformMatrix3fv(normalMatrixULoc, false, mat3.normalFromMat4(mat3.create(), modelMatrix));

    gl.uniform3fv(ambientULoc,  model.material.ambient);
    gl.uniform3fv(diffuseULoc,  model.material.diffuse);
    gl.uniform3fv(specularULoc, model.material.specular);
    gl.uniform1f(shininessULoc, model.material.n);
    gl.uniform1f(alphaULoc,     model.alpha);

    bindTextures(model);

    gl.bindBuffer(gl.ARRAY_BUFFER, model.vertexBuffer);
    gl.vertexAttribPointer(vertexPositionAttrib,   3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, model.normalBuffer);
    gl.vertexAttribPointer(vertexFaceNormalAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, model.vertexNormalBuffer);
    gl.vertexAttribPointer(vertexNormalAttrib,     3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, model.uvBuffer);
    gl.vertexAttribPointer(vertexUVAttrib,         2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, model.vertexCount);
}

function bindTextures(model) {
    gl.uniform1i(unlitULoc,  model.unlit ? 1 : 0);
    gl.uniform1f(cutoutULoc, model.cutout);
    var hasTex = (model.texture !== null);
    gl.uniform1i(useTextureULoc, hasTex ? 1 : 0);
    if (hasTex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, model.texture);
        gl.uniform1i(texSamplerULoc, 0);
    }
    var hasTex2 = (model.texture2 !== null);
    gl.uniform1i(useTexture2ULoc, hasTex2 ? 1 : 0);
    if (hasTex2) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, model.texture2);
        gl.uniform1i(tex2SamplerULoc, 1);
    }
}

// Compute the plane {n, d} for a triangle given its flat vertex array [x0,y0,z0,...]
function bspPlane(verts) {
    var v0 = vec3.fromValues(verts[0], verts[1], verts[2]);
    var v1 = vec3.fromValues(verts[3], verts[4], verts[5]);
    var v2 = vec3.fromValues(verts[6], verts[7], verts[8]);
    var e1 = vec3.subtract(vec3.create(), v1, v0);
    var e2 = vec3.subtract(vec3.create(), v2, v0);
    var n  = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), e1, e2));
    return { n: n, d: -vec3.dot(n, v0) };
}

// Classify a centroid against a plane: returns +1 (front), -1 (back), 0 (coplanar)
function bspClassify(plane, centroid) {
    var dist = vec3.dot(plane.n, centroid) + plane.d;
    if (dist >  1e-5) return  1;
    if (dist < -1e-5) return -1;
    return 0;
}

// Build a BSP tree from an array of triangle records { rt, model, Mmodel, worldCentroid }
// Returns a node: { plane, pivot, front, back }
function buildBSP(tris) {
    if (tris.length === 0) return null;
    var pivotTri  = tris[0];
    // Transform the pivot's local verts into world space so the plane is in the same
    // coordinate system as the world-space centroids used for classification.
    var pv = pivotTri.rt.verts, M = pivotTri.Mmodel;
    var w0 = vec3.transformMat4(vec3.create(), vec3.fromValues(pv[0],pv[1],pv[2]), M);
    var w1 = vec3.transformMat4(vec3.create(), vec3.fromValues(pv[3],pv[4],pv[5]), M);
    var w2 = vec3.transformMat4(vec3.create(), vec3.fromValues(pv[6],pv[7],pv[8]), M);
    var plane = bspPlane([w0[0],w0[1],w0[2], w1[0],w1[1],w1[2], w2[0],w2[1],w2[2]]);
    var front = [], back = [], coplanar = [pivotTri];

    for (var i = 1; i < tris.length; i++) {
        var c = bspClassify(plane, tris[i].worldCentroid);
        if      (c > 0) front.push(tris[i]);
        else if (c < 0) back.push(tris[i]);
        else            coplanar.push(tris[i]);
    }

    return { plane: plane, pivot: coplanar, front: buildBSP(front), back: buildBSP(back) };
}

// Traverse the BSP tree back-to-front relative to the eye (world space),
// calling drawFn for each triangle record in correct order.
function traverseBSP(node, eye, drawFn) {
    if (node === null) return;
    var side = vec3.dot(node.plane.n, eye) + node.plane.d;
    if (side >= 0) {
        traverseBSP(node.back,  eye, drawFn);
        for (var i = 0; i < node.pivot.length; i++) drawFn(node.pivot[i]);
        traverseBSP(node.front, eye, drawFn);
    } else {
        traverseBSP(node.front, eye, drawFn);
        for (var i = 0; i < node.pivot.length; i++) drawFn(node.pivot[i]);
        traverseBSP(node.back,  eye, drawFn);
    }
}

function collectTransparentTris(transparentModels) {
    var allTris = [];
    for (var mi = 0; mi < transparentModels.length; mi++) {
        var model  = transparentModels[mi];
        var Mmodel = getModelMatrix(model, false);
        for (var ti = 0; ti < model.rawTris.length; ti++) {
            var rt = model.rawTris[ti];
            var worldCentroid = vec3.transformMat4(vec3.create(), rt.centroid, Mmodel);
            allTris.push({ rt: rt, model: model, Mmodel: Mmodel, worldCentroid: worldCentroid });
        }
    }
    return allTris;
}

function drawTransparentTri(item) {
    var m = item.model;
    gl.uniformMatrix4fv(modelMatrixULoc, false, item.Mmodel);
    gl.uniformMatrix3fv(normalMatrixULoc, false, mat3.normalFromMat4(mat3.create(), item.Mmodel));
    gl.uniform3fv(ambientULoc,  m.material.ambient);
    gl.uniform3fv(diffuseULoc,  m.material.diffuse);
    gl.uniform3fv(specularULoc, m.material.specular);
    gl.uniform1f(shininessULoc, m.material.n);
    gl.uniform1f(alphaULoc,     m.alpha);
    bindTextures(m);

    var rt = item.rt;
    gl.bindBuffer(gl.ARRAY_BUFFER, rt.vertBuf);
    gl.vertexAttribPointer(vertexPositionAttrib,   3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rt.normBuf);
    gl.vertexAttribPointer(vertexFaceNormalAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rt.vNormBuf);
    gl.vertexAttribPointer(vertexNormalAttrib,     3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rt.uvBuf);
    gl.vertexAttribPointer(vertexUVAttrib,         2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Part 6: sort by view-space depth of the triangle centroid, farthest first, one draw call each
function renderPainterTransparent(transparentModels, viewMatrix) {
    var tris = collectTransparentTris(transparentModels);
    for (var i = 0; i < tris.length; i++)
        tris[i].depth = vec3.transformMat4(vec3.create(), tris[i].worldCentroid, viewMatrix)[2];
    tris.sort(function(a, b) { return a.depth - b.depth; }); // view looks down -z, so most negative is farthest
    for (var i = 0; i < tris.length; i++) drawTransparentTri(tris[i]);
}

// Part 7
function renderBSPTransparent(transparentModels) {
    var root = buildBSP(collectTransparentTris(transparentModels));
    traverseBSP(root, Eye, drawTransparentTri);
}

function flattenLights(property) {
    var v = new Float32Array(MAX_LIGHTS * 3);
    for (var i=0; i<lights.length; i++) v.set(lights[i][property], i*3);
    return v;
}

function handleKeyDown(event) {
    if (event.target.tagName === "INPUT") return;
    var axes = getViewAxes();
    var haveSelection = (selectedModel >= 0);
    if ("adwsqeADWS".indexOf(event.key) >= 0) autoRun = false;

    switch (event.key) {

        case "!": buildCustomScene(); break;
        case "0": restoreAssignmentScene(); break;

        case "b": blendMode = (blendMode + 1) % 3; updateStatus(); break;
        case ",": sortMode = (sortMode + 2) % 3; updateStatus(); break;
        case ".": sortMode = (sortMode + 1) % 3; updateStatus(); break;

        case "a": vec3.scaleAndAdd(Eye,Eye,axes.right,  -TRANSLATE_STEP); break;
        case "d": vec3.scaleAndAdd(Eye,Eye,axes.right,   TRANSLATE_STEP); break;
        case "w": vec3.scaleAndAdd(Eye,Eye,axes.forward, TRANSLATE_STEP); break;
        case "s": vec3.scaleAndAdd(Eye,Eye,axes.forward,-TRANSLATE_STEP); break;
        case "q": vec3.scaleAndAdd(Eye,Eye,axes.up,      TRANSLATE_STEP); break;
        case "e": vec3.scaleAndAdd(Eye,Eye,axes.up,     -TRANSLATE_STEP); break;
        case "A": rotateVector(LookAt,axes.up, ROTATE_STEP);  break;
        case "D": rotateVector(LookAt,axes.up,-ROTATE_STEP);  break;
        case "W": rotateVector(LookAt,axes.right,-ROTATE_STEP); rotateVector(Up,axes.right,-ROTATE_STEP); break;
        case "S": rotateVector(LookAt,axes.right, ROTATE_STEP); rotateVector(Up,axes.right, ROTATE_STEP); break;

        case "ArrowRight": event.preventDefault();
            if (models.length > 0) selectedModel = (selectedModel + 1) % models.length; break;
        case "ArrowLeft":  event.preventDefault();
            if (models.length > 0) selectedModel = (selectedModel <= 0) ? models.length-1 : selectedModel-1; break;
        case " ": event.preventDefault(); selectedModel = -1; break;

        case "k": if (haveSelection) translateSelection(axes.right, -TRANSLATE_STEP); break;
        case ";": if (haveSelection) translateSelection(axes.right,  TRANSLATE_STEP); break;
        case "o": if (haveSelection) translateSelection(axes.forward, TRANSLATE_STEP); break;
        case "l": if (haveSelection) translateSelection(axes.forward,-TRANSLATE_STEP); break;
        case "i": if (haveSelection) translateSelection(axes.up,     TRANSLATE_STEP); break;
        case "p": if (haveSelection) translateSelection(axes.up,    -TRANSLATE_STEP); break;
        case "K": if (haveSelection) rotateSelection(axes.up,  -ROTATE_STEP); break;
        case ":": if (haveSelection) rotateSelection(axes.up,   ROTATE_STEP); break;
        case "O": if (haveSelection) rotateSelection(axes.right,-ROTATE_STEP); break;
        case "L": if (haveSelection) rotateSelection(axes.right, ROTATE_STEP); break;
        case "I": if (haveSelection) rotateSelection(axes.forward, ROTATE_STEP); break;
        case "P": if (haveSelection) rotateSelection(axes.forward,-ROTATE_STEP); break;
    }
}

// Part 8: "Downhill Run", built from meshes and textures of my Unity snowboarding game.
// FBX models were converted offline to the assignment's triangle JSON (assets/snowboard_parts.json).
// ! starts/restarts the scene, 0 returns to the assignment scene.
const ASSET_BASE = "assets/";
var sceneTick = null;
var autoRun   = false;

// small deterministic PRNG so the forest is the same every run (mulberry32)
function makeRng(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function newAccum(proto) {
    return { material: proto.material, unlit: proto.unlit, cutout: proto.cutout,
             vertices: [], normals: [], uvs: [], triangles: [] };
}

// append a copy of triangle set 'src' transformed by M to accumulator 'dst'
function bakeInstance(dst, src, M) {
    var NM = mat3.normalFromMat4(mat3.create(), M), base = dst.vertices.length;
    for (var i = 0; i < src.vertices.length; i++) {
        dst.vertices.push(Array.from(vec3.transformMat4(vec3.create(), src.vertices[i], M)));
        var n = vec3.transformMat3(vec3.create(), src.normals[i], NM);
        dst.normals.push(Array.from(vec3.normalize(n, n)));
        dst.uvs.push(src.uvs[i]);
    }
    for (var t = 0; t < src.triangles.length; t++) {
        var tr = src.triangles[t];
        dst.triangles.push([tr[0] + base, tr[1] + base, tr[2] + base]);
    }
}

// flat textured quad from four corner points (counter-clockwise), uv spans [u0,u1]x[v0,v1]
function quadSet(p, material, tex, extra, u0, u1, v0, v1) {
    var m = {}; for (var k in material) m[k] = material[k];
    if (tex) m.texture = tex;
    var s = { material: m,
              vertices: p, normals: [[0,0,-1],[0,0,-1],[0,0,-1],[0,0,-1]],
              uvs: [[u0,v0],[u1,v0],[u1,v1],[u0,v1]], triangles: [[0,1,2],[0,2,3]] };
    for (var k in extra) s[k] = extra[k];
    return s;
}

function buildCustomScene() {
    var parts = getJSONFile(ASSET_BASE + "snowboard_parts.json", "snowboard parts");
    if (parts == String.null) { console.log("Part 8: could not load assets/snowboard_parts.json"); return; }

    models = []; selectedModel = -1;
    gl.clearColor(0.13, 0.21, 0.36, 1.0);

    var THETA = 12 * Math.PI / 180;
    var D   = vec3.fromValues(0, -Math.sin(THETA), Math.cos(THETA));
    var NRM = vec3.fromValues(0,  Math.cos(THETA), Math.sin(THETA));
    var LAT = vec3.cross(vec3.create(), NRM, D);
    function slopePoint(x, s, h) {
        return vec3.fromValues(x, s*D[1] + h*NRM[1], s*D[2] + h*NRM[2]);
    }
    function frameMatrix(X, Y, Z, P) {
        return mat4.fromValues(X[0],X[1],X[2],0, Y[0],Y[1],Y[2],0, Z[0],Z[1],Z[2],0, P[0],P[1],P[2],1);
    }
    var rng = makeRng(461);
    var RUN_START = -2, RUN_END = 44;

    var SK = 16, R = 30, LATMAX = 40 * Math.PI / 180, yTop = R * Math.tan(LATMAX);
    var vTop = 0.5 + LATMAX / Math.PI, vBot = 0.5 - LATMAX / Math.PI;
    var skyMat = { ambient:[1,1,1], diffuse:[1,1,1], specular:[0,0,0], n:1, alpha:1 };
    var skyModels = [];
    for (var k = 0; k < SK; k++) {
        var a0 = 2*Math.PI*k/SK, a1 = 2*Math.PI*(k+1)/SK;
        var q = quadSet([[R*Math.cos(a0),-yTop,R*Math.sin(a0)],[R*Math.cos(a1),-yTop,R*Math.sin(a1)],
                         [R*Math.cos(a1), yTop,R*Math.sin(a1)],[R*Math.cos(a0), yTop,R*Math.sin(a0)]],
                        skyMat, "skybox2.png", { unlit:true, sky:true }, k/SK, (k+1)/SK, vBot, vTop);
        addModel(q, ASSET_BASE);
        var sm = models[models.length-1]; sm.center = vec3.create(); skyModels.push(sm);
    }

    [[-62, 90, 0], [0, 96, 1], [64, 92, 0]].forEach(function(mp) {
        var mz = slopePoint(0, mp[1], 0), mw = 72, mh = mw * 576 / 1024;
        var u0 = mp[2] ? 1 : 0, u1 = mp[2] ? 0 : 1;
        addModel(quadSet([[mp[0]-mw/2, mz[1]-2, mz[2]],[mp[0]+mw/2, mz[1]-2, mz[2]],
                          [mp[0]+mw/2, mz[1]-2+mh, mz[2]],[mp[0]-mw/2, mz[1]-2+mh, mz[2]]],
            { ambient:[1,1,1], diffuse:[0.74,0.82,0.96], specular:[0,0,0], n:1, alpha:0.999 }, "mountain.png",
            { unlit:true }, u0, u1, 0, 1), ASSET_BASE);
    });

    var gx = 70, g0 = -10, g1 = 100, tile = 0.8;
    var g = [slopePoint(-gx,g0,0), slopePoint(gx,g0,0), slopePoint(gx,g1,0), slopePoint(-gx,g1,0)].map(function(v){return Array.from(v);});
    var ground = quadSet(g, { ambient:[0.32,0.32,0.33], diffuse:[0.78,0.78,0.80], specular:[0.08,0.08,0.1], n:20, alpha:1 },
                         "snow.png", {}, -gx/tile, gx/tile, g0/tile, g1/tile);
    ground.normals = [Array.from(NRM),Array.from(NRM),Array.from(NRM),Array.from(NRM)];
    addModel(ground, ASSET_BASE);

    var treeAcc = parts.tree.map(newAccum);
    treeAcc.forEach(function(a, i) { if (i < 4) a.cutout = 0.4; });
    for (var i = 0; i < 80; i++) {
        var side = (i % 2 === 0) ? 1 : -1;
        var x = side * (1.7 + rng() * 4.8), s = RUN_START - 3 + rng() * (RUN_END - RUN_START + 6);
        var h = 0.9 + rng() * 0.8, wd = h * (2.0 + rng() * 0.8), yaw = rng() * Math.PI * 2;
        var M = mat4.create();
        mat4.translate(M, M, slopePoint(x, s, -0.01));
        mat4.rotateY(M, M, yaw);
        mat4.scale(M, M, [wd, h, wd]);
        for (var p = 0; p < parts.tree.length; p++) bakeInstance(treeAcc[p], parts.tree[p], M);
    }
    treeAcc.forEach(function(a) { addModel(a, ASSET_BASE); });

    var rockAcc = newAccum(parts.rocks[0]);
    for (var i = 0; i < 14; i++) {
        var side = (i % 2 === 0) ? 1 : -1;
        var x = side * (1.5 + rng() * 1.3), s = RUN_START + rng() * (RUN_END - RUN_START);
        var sc = 0.10 + rng() * 0.2;
        var M = mat4.create();
        mat4.translate(M, M, slopePoint(x, s, -0.15 * sc));
        mat4.rotateY(M, M, rng() * Math.PI * 2);
        mat4.scale(M, M, [sc, sc * (0.8 + rng() * 0.5), sc]);
        bakeInstance(rockAcc, parts.rocks[i % parts.rocks.length], M);
    }
    addModel(rockAcc, ASSET_BASE);

    var fPost = newAccum(parts.fence[0]), fNet = newAccum(parts.fence[1]);
    fNet.cutout = 0.5;
    var FL = 0.23, FX = 1.3;
    for (var side = -1; side <= 1; side += 2) {
        for (var s = RUN_START - 4; s < RUN_END + 4; s += FL) {
            var M = frameMatrix(vec3.scale(vec3.create(), LAT, FL), vec3.scale(vec3.create(), NRM, FL),
                                vec3.scale(vec3.create(), D, FL), slopePoint(side * FX, s, 0));
            bakeInstance(fPost, parts.fence[0], M);
            bakeInstance(fNet,  parts.fence[1], M);
        }
    }
    addModel(fPost, ASSET_BASE); addModel(fNet, ASSET_BASE);

    var riderModels = parts.rider.map(function(part) {
        var acc = newAccum(part);
        bakeInstance(acc, part, mat4.fromScaling(mat4.create(), [0.2, 0.2, 0.2]));
        addModel(acc, ASSET_BASE);
        var m = models[models.length-1];
        m.center = vec3.create();
        return m;
    });

    var fogModels = [];
    for (var i = 0; i < 10; i++) {
        var w = 1.4 + rng() * 1.2, hh = 0.35 + rng() * 0.25;
        addModel(quadSet([[-w/2,-hh/2,0],[w/2,-hh/2,0],[w/2,hh/2,0],[-w/2,hh/2,0]],
            { ambient:[1,1,1], diffuse:[0.86,0.91,1.0], specular:[0,0,0], n:1, alpha:0.45 }, "fog.png",
            { unlit:true }, 0, 1, 0, 1), ASSET_BASE);
        var fm = models[models.length-1];
        fogModels.push({ model: fm, x: (rng() - 0.5) * 3.0, s: RUN_START + 4 + i * (RUN_END - RUN_START) / 10,
                         h: 0.12 + rng() * 0.25, phase: rng() * 6.28 });
    }

    var sprayModels = [];
    for (var i = 0; i < 9; i++) {
        var w = 0.10;
        addModel(quadSet([[-w/2,-w/2,0],[w/2,-w/2,0],[w/2,w/2,0],[-w/2,w/2,0]],
            { ambient:[1,1,1], diffuse:[1,1,1], specular:[0,0,0], n:1, alpha:0.5 }, "fog.png",
            { unlit:true }, 0, 1, 0, 1), ASSET_BASE);
        sprayModels.push({ model: models[models.length-1], jitter: [rng()-0.5, rng()] });
    }

    lights = [
        { position:[6,14,-10], ambient:[0.46,0.46,0.50], diffuse:[0.95,0.92,0.86], specular:[0.6,0.6,0.6] },
        { position:[-4,6,30],  ambient:[0.10,0.11,0.14], diffuse:[0.14,0.17,0.24], specular:[0.05,0.05,0.1] }
    ];

    var SPEED = 0.9, RUN_LEN = RUN_END - RUN_START;
    function sway(s)    { return 0.55*Math.sin(0.55*s) + 0.18*Math.sin(1.3*s); }
    function swayD(s)   { return 0.55*0.55*Math.cos(0.55*s) + 0.18*1.3*Math.cos(1.3*s); }
    function swayDD(s)  { return -0.55*0.55*0.55*Math.sin(0.55*s) - 0.18*1.3*1.3*Math.sin(1.3*s); }
    // rotate a flat quad about the vertical axis so it faces the eye (billboard)
    function faceEye(model) {
        var yaw = Math.atan2(Eye[0] - model.translation[0], Eye[2] - model.translation[2]);
        model.rotation = mat4.fromYRotation(mat4.create(), yaw);
    }
    var t0 = performance.now() / 1000;

    autoRun = true;
    sceneTick = function(nowMs) {
        var t = nowMs / 1000 - t0;
        var s = RUN_START + ((t * SPEED) % RUN_LEN);
        var x = sway(s);
        var P = slopePoint(x, s, 0.003);

        var Dir = vec3.normalize(vec3.create(), vec3.scaleAndAdd(vec3.create(), D, LAT, swayD(s)));
        var Z = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), Dir, NRM));
        var Y = vec3.cross(vec3.create(), Z, Dir);
        var R = mat4.multiply(mat4.create(), mat4.fromRotation(mat4.create(), -0.7 * swayDD(s), Dir),
                              frameMatrix(Dir, Y, Z, [0,0,0]));
        for (var i = 0; i < riderModels.length; i++) {
            riderModels[i].rotation = R;
            vec3.copy(riderModels[i].translation, P);
        }

        for (var i = 0; i < skyModels.length; i++) vec3.copy(skyModels[i].translation, Eye);

        for (var i = 0; i < fogModels.length; i++) {
            var f = fogModels[i];
            var fx = f.x + 0.6 * Math.sin(0.25 * t + f.phase);
            vec3.copy(f.model.translation, slopePoint(fx, f.s, f.h));
            faceEye(f.model);
        }

        for (var i = 0; i < sprayModels.length; i++) {
            var age = ((t * 0.9 + i / sprayModels.length) % 1);
            var sp = sprayModels[i];
            var back = vec3.scaleAndAdd(vec3.create(), P, Dir, -0.05 - age * 0.55);
            vec3.scaleAndAdd(back, back, NRM, 0.015 + age * 0.12);
            vec3.scaleAndAdd(back, back, LAT, sp.jitter[0] * 0.12 * age);
            vec3.copy(sp.model.translation, back);
            faceEye(sp.model);
            sp.model.alpha = 0.45 * (1 - age) * (1 - age);
        }

        lights[0].position = [Eye[0] + 6, Eye[1] + 14, Eye[2] - 10];

        if (autoRun) {
            var cam = vec3.scaleAndAdd(vec3.create(), P, D, -0.50);
            vec3.scaleAndAdd(cam, cam, NRM, 0.24);
            cam[0] = P[0] * 0.55;
            vec3.copy(Eye, cam);
            var target = vec3.scaleAndAdd(vec3.create(), P, D, 0.65);
            vec3.scaleAndAdd(target, target, NRM, 0.02);
            vec3.normalize(LookAt, vec3.subtract(vec3.create(), target, Eye));
            vec3.set(Up, 0, 1, 0);
        }
    };
    sceneTick(performance.now());
}

function restoreAssignmentScene() {
    sceneTick = null; autoRun = false;
    models = []; selectedModel = -1;
    Eye = vec3.clone(defaultEye); LookAt = vec3.clone(defaultLookAt); Up = vec3.clone(defaultUp);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    lights = [{ position: [-0.5, 1.5, -0.5], ambient: [1,1,1], diffuse: [1,1,1], specular: [1,1,1] }];
    loadTriangles();
    loadLights();
}

function applyViewSettings() {
    var canvas = document.getElementById("myWebGLCanvas");
    var w  = parseInt(document.getElementById("canvasWidth").value);
    var h  = parseInt(document.getElementById("canvasHeight").value);
    var l  = parseFloat(document.getElementById("winLeft").value);
    var r  = parseFloat(document.getElementById("winRight").value);
    var b  = parseFloat(document.getElementById("winBottom").value);
    var t  = parseFloat(document.getElementById("winTop").value);
    if (w > 0 && h > 0) { canvas.width=w; canvas.height=h; gl.viewport(0,0,w,h); }
    if (isFinite(l)&&isFinite(r)&&isFinite(b)&&isFinite(t)&&l!==r&&b!==t) {
        winLeft=l; winRight=r; winBottom=b; winTop=t;
    }
}

function renderTriangles() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    requestAnimationFrame(renderTriangles);

    if (sceneTick) sceneTick(performance.now());

    var scale = winNear / winDist;
    var center = vec3.add(vec3.create(), Eye, LookAt);
    var viewMatrix = mat4.lookAt(mat4.create(), Eye, center, Up);
    var projMatrix = mat4.frustum(mat4.create(),
        winLeft*scale, winRight*scale, winBottom*scale, winTop*scale, winNear, winFar);

    gl.uniformMatrix4fv(viewMatrixULoc, false, viewMatrix);
    gl.uniformMatrix4fv(projMatrixULoc, false, projMatrix);

    gl.uniform3fv(eyePositionULoc,   Eye);
    gl.uniform1i (numLightsULoc,     lights.length);
    gl.uniform3fv(lightPositionULoc, flattenLights("position"));
    gl.uniform3fv(lightAmbientULoc,  flattenLights("ambient"));
    gl.uniform3fv(lightDiffuseULoc,  flattenLights("diffuse"));
    gl.uniform3fv(lightSpecularULoc, flattenLights("specular"));
    gl.uniform1i (blendModeULoc,     blendMode);

    var opaqueModels = [], transparentModels = [];
    for (var i=0; i<models.length; i++) {
        if (models[i].isTransparent) transparentModels.push(models[i]);
        else                         opaqueModels.push(models[i]);
    }

    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    for (var i=0; i<opaqueModels.length; i++)
        if (opaqueModels[i].isSky) drawModel(opaqueModels[i], false);
    gl.enable(gl.DEPTH_TEST);

    gl.depthMask(true);
    for (var i=0; i<opaqueModels.length; i++) {
        if (opaqueModels[i].isSky) continue;
        drawModel(opaqueModels[i], opaqueModels[i] === models[selectedModel]);
    }

    gl.enable(gl.BLEND);
    // Porter-Duff 'over': correct alpha compositing against transparent canvas background
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
                         gl.ONE,       gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    if (transparentModels.length > 0) {
        if (sortMode === 0) {
            for (var i=0; i<transparentModels.length; i++) drawModel(transparentModels[i], false);
        } else if (sortMode === 1) {
            renderPainterTransparent(transparentModels, viewMatrix);
        } else {
            renderBSPTransparent(transparentModels);
        }
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function main() {
    setupWebGL();
    loadTriangles();
    loadLights();
    setupShaders();
    updateStatus();

    document.getElementById("applyView").onclick = applyViewSettings;
    document.addEventListener("keydown", handleKeyDown);

    renderTriangles();
}
