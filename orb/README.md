# The Alice orb on the website

Alice as she is in the app: the orb, live. On the homepage she sits in the middle of the sources diagram, and when the light from the three sources reaches her she listens, takes each one in with a pulse, reads them, and lights up as the light leaves her for the three steps. It is homepage v9's orb and v9's round, running in WebGL 2 over a still image of itself, so the diagram never shows an empty box.

**Open [`test.html`](test.html) by double-clicking it** to see the homepage's sources section as it is built in Webflow, with the orb. You can switch between the live orb and the still, the desktop and the phone diagram, and 60 or 30 frames a second. The bar at the top says how many frames a second your machine is drawing and what Alice is doing.

## What's here

| File | |
|---|---|
| `alice-orb.min.js` | What the website loads. 54 KB, about 20 KB compressed. Most of it is the orb's shader, which is kept exactly as it is in v9. |
| `alice-orb.js` | The same code, readable. |
| `images/still.webp` | The still under the orb: a frame of v9's orb in the diagram, at twice its size (261 × 261, 23 KB). On the website it is `home-orb.webp` in Webflow's Assets. |
| `src/` | The source. `src/lib/orb.js` is v9's orb (from `alice-app-v9.js`, which lifted it from the Orb Lab), unchanged but for two lines marked 1.1.0 that let it draw straight into its canvas; `src/gl.js` is the orb's WebGL context, on the canvas on the page; `src/site.js` runs it on the website. |
| `tools/build.mjs` | Makes the two script files from `src/`. |
| `test.html` | The test page. |

At the same size, a frame drawn by this script is the same frame as homepage v9's, pixel for pixel: checked through a whole round (listening, the three pulses, reading, the finish, rest) at 1×, 2× and 3× pixel density, and again for 1.1.0. What 1.1.0 changes is the size it is drawn at on standard screens (see below).

## What it does on a page

- Puts a canvas in every element the loader names. When its first frame is drawn, the canvas fades in (700 ms) and the still under it fades out.
- Plays v9's round, in step with the diagram's lines. The rounds follow the lines' own animation (the light along them is CSS, in the Home CSS embed), so the orb takes a source in exactly when its light arrives. Coming on screen in the middle of a round, Alice waits for the next one.
- Makes its WebGL context and compiles the orb's shaders while the browser is idle, shortly before the orb comes on screen, so nothing stutters as it scrolls in.
- Draws only while the orb is on screen and the tab is visible. A round it has started is finished even if the orb is scrolled away, then it stops.
- Draws 60 frames a second (30 if the loader says so). The motion is timed by the clock, so it has the same speed either way.
- Draws at 2 pixels per CSS pixel on every screen: the homepage's orb is 256 × 256 pixels. On a standard screen (1 pixel per CSS pixel) the browser shrinks it to fit, which makes it as sharp as on a Retina screen; v9 drew it at 128 × 128 there, which left it soft.
- Keeps an eye on the frame rate: on a device that draws under 70% of the frames it should, the orb is drawn at the screen's own density instead; under 12 frames a second for 2.5 seconds even so, the still comes back (as the gradient stops on such a device).
- Leaves the still in place for people who have turned motion off (`prefers-reduced-motion`); the light along the lines is off for them too.
- Without WebGL 2, or if the orb's shaders don't compile on a device, it does nothing and the still stays.
- Has a WebGL context of its own, on the one canvas it puts on the page, and draws the orb straight into it; the canvas moves to whichever orb is showing (on the homepage, the desktop or the phone diagram). If the browser takes the context away, the still shows at once until it is given back.

## In Webflow

**1. The script.** The loader in the site's footer code loads it (see the [main README](../README.md)). Its lines for this piece:

```js
var ORB = '.home-flow_orb, .home-flow-v_orb';   /* where the orb goes: Alice in the homepage's sources diagram */
…
{ on: ORB, file: 'v1.3.0/orb/alice-orb.min.js',
  integrity: 'sha384-EFjUvW6KKZkFgjQvViWB7GCk68ka6OrrcujVSkHZYT5ZEtT5/luk8/hJ/VzUfAWa',
  data: { targets: ORB, sync: '.pl:not(.out)', fps: '60' } }
```

- `targets`: the elements that get an orb, the same list as `on`.
- `sync`: the elements whose animation the rounds follow. On the homepage that is the light running along the lines (`.pl`), but not the light going out to the three steps (`.out`). Of these, the orb follows the one near it that starts first. Without `sync`, Alice plays a round every 6.4 seconds from 1.3 seconds after she comes on screen, as in v9.
- `fps`: frames a second, 60 or 30.

The `integrity` value belongs to this version's file; every version has its own.

**2. The element.** A box the size of the orb (8 rem in the desktop diagram, 6.5 rem in the phone diagram), with the still inside it as an Image: `home-orb.webp`, 100% wide and high, empty alt text. The script puts its canvas over the image, and makes the box `position: relative` if it isn't positioned.

**3. Another orb.** Any element can get one: add its class to `ORB` (with a still inside it, as above). The round plays wherever there are lines to follow nearby; elsewhere it runs on its own clock.

## Changing the orb, making a new version

1. The orb itself is `src/lib/orb.js`, a copy of v9's. A change to how the orb looks or moves belongs in the app's orb first, then gets copied here unchanged. The website's part, the round and when it draws, is `src/site.js`.
2. Raise `version` in `package.json`, then `npm run build` (Node 18 or newer).
3. Open `test.html` and check it.
4. Commit, make a release with the new tag, and update the website: the loader's `file` and `integrity` (`openssl dgst -sha384 -binary alice-orb.min.js | openssl base64 -A` gives the integrity, after `sha384-`). Publish.

## Versions

**1.1.0** (15 October 2026, in release v1.3.0 of this repository)
- Drawn straight into the canvas on the page. Until now, as in v9, the orb was drawn into a hidden canvas shared with the gradient and each frame copied onto the canvas on the page; on some computers the page could show a copy that was only partly updated. Now a frame reaches the screen whole, and there is no copy to make.
- Drawn at 2 pixels per CSS pixel on every screen, so on standard screens it is as sharp as on Retina ones (it was soft there). At the same size the frames are v9's, pixel for pixel.
- A device that can't keep up gets the screen's own density, then the still (see "What it does on a page").
- No longer shares a context with the gradient: from Alice Ground 1.3.0 each has its own.

**1.0.0** (15 October 2026, in release v1.2.0 of this repository): first release.
