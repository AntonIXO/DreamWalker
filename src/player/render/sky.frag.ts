import { DREAM_FX_VERTEX } from "./dreamFx.frag";

export const SKY_VERTEX = DREAM_FX_VERTEX;

/**
 * Screen-space sky. Pixelated on purpose so it sits under 16px tiles instead of
 * looking like a smooth backdrop pasted on a pixel game.
 *
 * `uCover` is 0..1, inverted weather: night when nobody has noticed you, a too-nice
 * day when they have. Palettes are lerped on the CPU and handed over as colours.
 */
export const SKY_FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform highp vec4 uInputSize;
uniform float uTime;
uniform float uCover;
uniform float uReduced;
uniform float uRain;
uniform float uStars;
uniform float uSunSize;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCloud;
uniform vec3 uSun;

float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main()
{
    vec2 px = uInputSize.xy;
    float cell = 3.0;
    vec2 uv = floor(vTextureCoord * px / cell) * cell / px;
    float y = uv.y;
    vec3 colour = mix(uZenith, uHorizon, smoothstep(0.12, 0.92, y));

    float drift = uReduced > 0.5 ? 0.0 : uTime * 0.018;
    float lumps = noise(uv * vec2(5.5, 3.0) + vec2(drift, 0.0));
    float cloudAmt = smoothstep(0.48, 0.74, lumps) * (1.0 - uCover * 0.85);
    colour = mix(colour, uCloud, cloudAmt * 0.78);

    vec2 sunAt = vec2(0.74, mix(1.18, 0.2, uCover));
    float sun = 1.0 - smoothstep(uSunSize, uSunSize + 0.012, distance(uv, sunAt));
    colour = mix(colour, uSun, sun * clamp(uCover * 1.4, 0.0, 1.0));

    if (uStars > 0.01)
    {
        float star = step(0.992, hash21(floor(uv * px / cell)));
        colour += vec3(star) * uStars * (1.0 - sun);
    }

    if (uRain > 0.01)
    {
        float drop = fract(uv.x * 38.0 + uv.y * (18.0 + (1.0 - uReduced) * uTime * 4.5));
        float streak = step(0.93, drop) * (1.0 - y);
        colour = mix(colour, mix(colour, uCloud, 0.55), streak * uRain);
    }

    // Five-stop posterise, same family as the tile atlas.
    colour = floor(colour * 5.0 + 0.5) / 5.0;
    finalColor = vec4(colour, 1.0);
}
`;
