# Alice Ground on the website

The moving brand gradient: light sources over an asymmetric wedge, coloured through an OKLCH ramp, with film grain. It runs in WebGL 2 over a still image of itself, so a section never shows an empty box.

**Open [`test.html`](test.html) by double-clicking it** to see the hero, the pricing plan and the closing, switch between the live gradient and the still image, compare 30 and 60 frames a second, and see the phone versions. The bar at the top says how many frames a second your machine is drawing.

## What's here

| File | |
|---|---|
| `alice-ground.min.js` | What the website loads. 33.7 KB, 11–13 KB compressed. |
| `alice-ground.js` | The same code, readable. |
| `images/*.webp` | The stills under each gradient: the look's first frame without grain, saved small and without loss (5–34 KB each). |
| `images/grain.png` | The grain laid over the stills (9 KB). |
| `src/` | The source. `src/lib/` is the Alice-gradient-background sandbox's `ramp.js`, `shaders.js` and `renderer.js`, **unchanged**; `src/ds-field.js` is the design system's field (the hero, as in v5); `src/site.js` runs it on the website. |
| `tools/` | `build.mjs` makes the two script files from `src/`; `stills.mjs` makes the images. |

A frame drawn by this script is the same frame as homepage v9's, pixel for pixel (checked for every look at several moments).

## What it does on a page

- Finds every element with `data-alice-ground` and puts a canvas in it that fades in (900 ms) over the element's own background: the still.
- Starts only when its section comes near the screen; until then the page has no WebGL at all.
- Pauses when the section is scrolled away or the tab is hidden.
- Draws 30 frames a second (`data-fps="60"` for 60). The motion is timed by the clock, so it has the same speed either way.
- Takes the phone composition when the element is 479 px wide or narrower (Webflow's phone breakpoint), and switches if the width crosses it.
- Stops moving and keeps its last frame on a device that draws fewer than 12 frames a second for 2.5 seconds.
- Shows one still frame to people who have turned motion off (`prefers-reduced-motion`).
- Without WebGL 2 it does nothing, and the still stays.
- Uses one WebGL context for every gradient on the page, and recovers if the browser takes it away.

## In Webflow

**1. The script**, once, in Site settings → Custom code → Footer code (or the footer code of the pages that need it):

```html
<script src="https://cdn.jsdelivr.net/gh/<owner>/<repo>@v1.0.0/ground/alice-ground.min.js"
  integrity="sha384-+x4zHxlpl0qrw6jjo2yUKbOY8ELNrxy+EwNq2tg4v+zMA3qNVwbz9u+QIIOqQCaD"
  crossorigin="anonymous" data-fps="30" defer></script>
```

The `integrity` value belongs to v1.0.0's file; every version has its own (it stops a changed file from running).

**2. The grain over the stills**, once per page, in a Code Embed that sits with the gradient (so it also shows in the Designer, where scripts don't run):

```html
<style>
/* Alice Ground: the grain over each still, at the live canvas's density.
   The tile is added (plus-lighter), then taken off again elsewhere (difference): that makes the engine's own grain. */
[data-alice-ground] { isolation: isolate; }
@supports (mix-blend-mode: plus-lighter) and (mix-blend-mode: difference) {
  [data-alice-ground]::before, [data-alice-ground]::after {
    content: ""; position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 0; pointer-events: none;
    background: url(https://cdn.jsdelivr.net/gh/<owner>/<repo>@v1.0.0/ground/images/grain.png) 0 0 / 128px 128px repeat;
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

**3. The element.** A div that fills its section: position absolute, all sides 0, z-index 0, with a custom attribute `data-alice-ground` set to the look (`close`, `hero` or `plan`). Its background is the still over a fallback gradient (for the moment before the still has loaded), size 100% 100%, position 50% 0, no repeat. On the phone breakpoint, the phone still.

| Look | Desktop still (v9 box) | Phone still (v9 box) | Fallback gradient (180deg) |
|---|---|---|---|
| `close` | `close-desktop.webp` (1440 × 778) | `close-phone.webp` (390 × 694) | `#f0fcf8 0%, #effcf7 20%, #effcf7 40%, #e5f3ee 55%, #678383 70%, #00080b 85%, #000202 100%` · phone `#b1c6c2 0%, #effcf7 20%, #f0fcf7 40%, #effcf7 55%, #96aeab 70%, #000c0f 85%, #000202 100%` |
| `hero` | `hero-desktop.webp` (1440 × 1125) | `hero-phone.webp` (390 × 413) | `#ebfef6 0%, #e7fbf3 20%, #85ada9 40%, #145256 55%, #001a1f 70%, #00070b 85%, #000305 100%` |
| `plan` | `plan-desktop.webp` (792 × 631) | `plan-phone.webp` (358 × 833) | `#1f3e3f 0%, #113335 20%, #022326 40%, #00181c 55%, #000f13 70%, #00080c 85%, #000407 100%` |

Image URLs: `https://cdn.jsdelivr.net/gh/<owner>/<repo>@v1.0.0/ground/images/close-desktop.webp` and so on.

Anything inside the section that should sit on top of the gradient needs a higher z-index than the ground (the closing's white fade is 1, its content 2).

## Why the stills are made this way

v9's stills were JPEGs at 1× with the grain baked in. JPEG compresses in 8 × 8 blocks and grain is the hardest thing to compress, so it broke up into square patches, and Retina and phone screens enlarged them two to three times. These stills are the frame without grain, a quarter of the size and lossless: a smooth field loses nothing at that size, the browser scales it back up smoothly, and there is nothing in it to break into squares. The grain goes back on in CSS at the same density as the live canvas, added and taken off again so it is centred on the frame. With the grain on, the still matches the live frame within a level or two (the very brightest stay up to 5 levels short, the very darkest up to 3 over), which is what makes the fade from still to live invisible.

## Changing a look, making a new version

1. Find the look in the Alice-gradient-background sandbox. The website's looks are in `src/site.js` (`LOOKS`); a change to the library itself goes into `src/lib/` as a copy of the sandbox's file.
2. `npm install`, then `npx playwright install chromium` (once).
3. `npm run build` for the scripts, `npm run stills` for the images. Bump `version` in `package.json` first.
4. Open `test.html` and check it.
5. Commit, make a release with the new tag, point the website at it (script, grain and still URLs, and the new `integrity`), publish.
