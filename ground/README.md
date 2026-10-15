# Alice Ground on the website

The moving gradient: light sources over an asymmetric wedge, coloured through an OKLCH ramp, with film grain. It runs in WebGL 2 over a still image of itself, so a section never shows an empty box.

**Open [`test.html`](test.html) by double-clicking it** to see the hero, the pricing plan and the closing. You can switch between the live gradient and the still image, compare 30 and 60 frames a second, and see the phone versions; resize the window to try other proportions. The bar at the top says how many frames a second your machine is drawing.

## What's here

| File | |
|---|---|
| `alice-ground.min.js` | What the website loads. 33.8 KB, 11–13 KB compressed. |
| `alice-ground.js` | The same code, readable. |
| `images/*.webp` | The stills under each gradient: the look's first frame without grain, wider than any section it goes in, small and without loss (under 40 KB each). |
| `images/grain.png` | The grain laid over the stills (9 KB). |
| `src/` | The source. `src/lib/` is the Alice-gradient-background sandbox's `ramp.js`, `shaders.js` and `renderer.js`, **unchanged**; `src/ds-field.js` is the design system's field (the hero, as in v5); `src/site.js` runs it on the website. |
| `tools/` | `build.mjs` makes the two script files from `src/`; `stills.mjs` makes the images. |

Below 2600 device pixels a frame drawn by this script is the same frame as homepage v9's, pixel for pixel (checked for every look at several sizes and moments). Above that, see 1.1.0 under Versions.

## What it does on a page

- Finds every element with `data-alice-ground` and puts a canvas in it that fades in (900 ms) over the element's own background: the still.
- Starts only when its section comes near the screen; until then the page has no WebGL at all.
- Pauses when the section is scrolled away or the tab is hidden.
- Draws 30 frames a second (60 if the loader says so). The motion is timed by the clock, so it has the same speed either way.
- Takes the phone composition when the element is 479 px wide or narrower (Webflow's phone breakpoint), and switches if the width crosses it.
- Stops moving and keeps its last frame on a device that draws fewer than 12 frames a second for 2.5 seconds.
- Shows one still frame to people who have turned motion off (`prefers-reduced-motion`).
- Without WebGL 2 it does nothing, and the still stays.
- Uses one WebGL context for every gradient on the page, and recovers if the browser takes it away.
- Keeps the gradient's proportions on very large screens: a canvas is at most 2600 device pixels either way, and a bigger section is drawn at a lower resolution rather than squeezed.

## In Webflow

**1. The script.** The loader in the site's footer code loads it (see the [main README](../README.md)). Its line for this piece:

```js
{ on: '[data-alice-ground]', file: 'v1.1.0/ground/alice-ground.min.js',
  integrity: 'sha384-ckF9OkUmze1K2XUrHHmRe3sVVSNRlZIZ7qcBwXoQx6t9HS2pFKh3Ow6/rUQohuRb',
  data: { fps: '30' } }
```

The `integrity` value belongs to v1.1.0's file; every version has its own.

**2. The images** are copies in Webflow's Assets, named `alice-ground-close-desktop.webp` and so on.

**3. The grain over the stills**, in a Code Embed that sits with the gradient (so it also shows in the Designer, where scripts don't run). `url(…)` is the address of `alice-ground-grain.png` in Webflow's Assets:

```html
<style>
/* Alice Ground: the grain over each still, at the live canvas's density.
   The tile is added (plus-lighter), then taken off again elsewhere (difference): that makes the engine's own grain. */
[data-alice-ground] { isolation: isolate; }
@supports (mix-blend-mode: plus-lighter) and (mix-blend-mode: difference) {
  [data-alice-ground]::before, [data-alice-ground]::after {
    content: ""; position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0; pointer-events: none;
    background: url(…/alice-ground-grain.png) 0 0 / 128px 128px repeat;
  }
  [data-alice-ground]::before { mix-blend-mode: plus-lighter; }
  [data-alice-ground]::after { mix-blend-mode: difference; background-position: 61px 37px; }
  @media (min-resolution: 1.25dppx), (-webkit-min-device-pixel-ratio: 1.25) {
    [data-alice-ground]::before, [data-alice-ground]::after { background-size: 102.4px 102.4px; }
  }
  @media (min-resolution: 1.5dppx), (-webkit-min-device-pixel-ratio: 1.5) {
    [data-alice-ground]::before, [data-alice-ground]::after { background-size: 85.3333px 85.3333px; }
  }
}
</style>
```

**4. The element.** A div that fills its section: position absolute, all sides 0, z-index 0, with a custom attribute `data-alice-ground` set to the look (`close`, `hero` or `plan`). Its background is the still over a fallback gradient (the colour for the moment before the still has loaded):

- size **`auto 100%`** (the still is fitted to the height; the gradient under it fills the box),
- position **`50% 0%`** (centred),
- no repeat.

That is how the gradient itself is drawn: it scales with the section's height and shows more or less at the sides. So the still lines up with the moving gradient at any width, and the fade from one to the other is invisible.

| Look | Still | For | Fallback gradient (180deg) |
|---|---|---|---|
| `close` | `close-desktop.webp` (585 × 130) | sections wider than 479 px | `#f0fcf8 0%, #effcf7 20%, #effcf7 40%, #e5f3ee 55%, #678383 70%, #00080b 85%, #000202 100%` |
| `close` | `close-phone.webp` (116 × 116) | the phone breakpoint (479 px and narrower) | `#b1c6c2 0%, #effcf7 20%, #f0fcf7 40%, #effcf7 55%, #96aeab 70%, #000c0f 85%, #000202 100%` |
| `hero` | `hero.webp` (602 × 188) | every width | `#ebfef6 0%, #e7fbf3 20%, #85ada9 40%, #145256 55%, #001a1f 70%, #00070b 85%, #000305 100%` · phone `#eafef6 0%, #e5faf2 20%, #78a2a0 40%, #104f54 55%, #00191f 70%, #00070b 85%, #000305 100%` |
| `plan` | `plan.webp` (210 × 105) | every width | `#1f3e3f 0%, #113335 20%, #022326 40%, #00181c 55%, #000f13 70%, #00080c 85%, #000407 100%` · phone `#1a393a 0%, #0d2f32 20%, #002125 40%, #00171b 55%, #000e12 70%, #00070b 85%, #000406 100%` |

The hero and the plan use the same look on phones, so one still each covers every width. The closing has a phone look of its own.

Anything inside the section that should sit on top of the gradient needs a higher z-index than the ground (the closing's white fade is 1, its content 2).

## Why the stills are made this way

v9's stills were JPEGs at 1× with the grain baked in. JPEG compresses in 8 × 8 blocks and grain is the hardest thing to compress, so it broke up into square patches, and Retina and phone screens enlarged them two to three times. They were also made for one size of section and stretched to fill any other, while the gradient itself doesn't stretch, so at other widths the still had a different shape from the moving gradient.

These stills are the frame without grain, wide enough for any section, a sixth of the size and without loss. A smooth field loses nothing at that size (blown back up, it differs from the full-size frame by about half a level of 255 on average), the browser scales it back up smoothly, and there is nothing in it to break into squares. The grain goes back on in CSS at the same density as the live canvas, added and taken off again so it is centred on the frame. On the test page, at window widths from 320 to 2560 and pixel densities from 1× to 3×, the still with its grain matches the moving gradient within one or two levels of 255 on average and about five at most, which is what makes the fade from still to live invisible.

## Changing a look, making a new version

1. Find the look in the Alice-gradient-background sandbox. The website's looks are in `src/site.js` (`LOOKS`); a change to the library itself goes into `src/lib/` as a copy of the sandbox's file.
2. `npm install`, then `npx playwright install chromium` (once).
3. Raise `version` in `package.json`, then `npm run build` for the scripts and `npm run stills` for the images.
4. Open `test.html` and check it.
5. Commit, make a release with the new tag, and update the website: the loader's `file` and `integrity` (`openssl dgst -sha384 -binary alice-ground.min.js | openssl base64 -A` gives the integrity, after `sha384-`), new images into Webflow's Assets if they changed. Publish.

## Versions

**1.1.0** (15 October 2026)
- Stills wider than any section, fitted to the height and centred on the website (`background-size: auto 100%`), instead of made for v9's proportions and stretched. They now match the moving gradient at any width.
- Stills at a sixth of the size instead of a quarter, which measures the same; one still each for the hero and the plan (`hero.webp`, `plan.webp`), as their phone look is the same look.
- Stills fully opaque: 1.0.0's edges were partly see-through.
- The script keeps the gradient's proportions on very large screens: v9 cut a canvas over 2600 device pixels in one direction only, which squeezed the gradient sideways. Below that size every frame is the same as 1.0.0's.

**1.0.0** (15 October 2026): first release.
