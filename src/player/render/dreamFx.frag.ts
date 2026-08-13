/**
 * Pixi's default filter vertex — `Filter.from` does not inject one if we omit it.
 */
export const DREAM_FX_VERTEX = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/**
 * One-pass tear. Offsets are whole input pixels (`uInputSize.zw`) so 16px tiles
 * stay crisp. `uReduced` kills spatial work; colour grade and the overflow wash stay.
 */
export const DREAM_FX_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;

uniform float uTime;
uniform float uBurst;
uniform float uOverflow;
uniform int uPreset;
uniform vec2 uTonus;
uniform float uReduced;
uniform vec3 uCream;
uniform vec3 uLive;
uniform vec3 uTint;

float hash11(float n)
{
    return fract(sin(n) * 43758.5453123);
}

vec2 px(float x, float y)
{
    return vec2(x, y) * uInputSize.zw;
}

vec4 sampleAt(vec2 uv)
{
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main()
{
    float spatial = 1.0 - uReduced;
    float splitAmt = (uPreset == 1 ? 0.38 : 0.0) + uBurst;
    float edgeAmt = (uPreset == 2 ? 0.72 : 0.0) + uBurst * 0.45;
    float leakAmt = (uPreset == 3 ? 0.24 : 0.0) + uBurst * 0.18;

    float row = floor(vTextureCoord.y * uInputSize.y / 6.0);
    float jitter = hash11(row + floor(uTime * 17.0)) - 0.5;
    float shiftPx = jitter * 7.0 * splitAmt * spatial;
    vec2 uv = vTextureCoord + px(shiftPx, 0.0);

    float chroma = (1.5 + 5.0 * uBurst) * max(splitAmt, uBurst) * spatial;
    vec4 sampleR = sampleAt(uv + px(chroma, 0.0));
    vec4 sampleG = sampleAt(uv);
    vec4 sampleB = sampleAt(uv - px(chroma, 0.0));
    vec4 color = vec4(sampleR.r, sampleG.g, sampleB.b, sampleG.a);

    float ghostPx = (1.0 + edgeAmt) * spatial;
    vec4 ghostA = sampleAt(uv + px(ghostPx, -ghostPx));
    vec4 ghostB = sampleAt(uv + px(-ghostPx, ghostPx));
    float outline = abs(ghostA.r - ghostB.r)
        + abs(ghostA.g - ghostB.g)
        + abs(ghostA.b - ghostB.b);
    color.rgb = mix(color.rgb, ghostA.rgb, 0.11 * edgeAmt * spatial);
    color.rgb = mix(
        color.rgb,
        mix(uCream, uLive, 0.28),
        clamp(outline * edgeAmt * 1.6, 0.0, 0.62)
    );

    float staticAmt = max(0.0, -uTonus.y) * 0.55 + uBurst * 0.22;
    if (spatial > 0.5 && staticAmt > 0.01)
    {
        vec4 smear = sampleAt(uv + px(1.0, 0.0));
        color.rgb = mix(color.rgb, smear.rgb, staticAmt * 0.2);
    }

    if (leakAmt > 0.001)
    {
        vec3 away = vec3(0.52, 0.47, 0.53) - uLive;
        vec3 leaked = color.rgb + away * 0.42;
        leaked = floor(leaked * 5.0 + 0.5) / 5.0;
        color.rgb = mix(color.rgb, leaked, leakAmt);
    }

    float upper = uTonus.x;
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    if (upper > 0.0)
    {
        color.rgb = mix(color.rgb, mix(color.rgb, uLive, 0.4), upper * 0.16);
    }
    else
    {
        color.rgb = mix(color.rgb, vec3(luma) * 0.82, (-upper) * 0.18);
    }

    float dyn = max(0.0, uTonus.y);
    float scan = sin(vTextureCoord.y * uInputSize.y * 3.14159 + uTime * 8.0);
    color.rgb *= 1.0 - dyn * 0.035 * (0.5 + 0.5 * scan);

    color.rgb = mix(color.rgb, 1.0 - color.rgb, uOverflow);
    color.rgb = mix(color.rgb, uCream, uOverflow * 0.42);
    color.rgb = mix(color.rgb, uTint, uBurst * 0.2);

    if (uReduced > 0.5)
    {
        color.rgb *= 1.0 - uBurst * 0.14;
        color.rgb = mix(color.rgb, uCream, uOverflow * 0.2);
    }

    finalColor = color;
}
`;
