# alice-website-assets

The code that runs on alice.law on top of what Webflow builds itself, one folder per piece. The website loads it from here through [jsDelivr](https://www.jsdelivr.com/), pinned to a release, so nothing on the site changes when this repository changes.

| Folder | What it is |
|---|---|
| [`ground/`](ground/) | **Alice Ground**, the moving brand gradient behind the hero, the pricing plan and the closing: the script, the still images under it and the grain. See [`ground/README.md`](ground/README.md). |
| [`orb/`](orb/) | **The orb**, Alice as she is in the app, live: on the homepage, in the middle of the sources diagram, in step with its lines. The script and the still image under it. See [`orb/README.md`](orb/README.md). |

## On the website

**The loader.** One small script in Webflow's Site settings → Custom code → Footer code, below the nav script, loads the pieces a page uses once the page has finished loading (or after 8 seconds, if something else on the page never finishes). A page without them loads nothing, and a slow or missing file holds nothing up: the still image stays until the code arrives. This is it, as it is on the site:

```html
<script>
/* Alice website code: loads the coded pieces a page uses (the moving gradient, Alice Ground, and the orb) from
   github.com/alicelegaltech/alice-website-assets through jsDelivr, after the page has finished loading,
   so a slow or missing file never holds the page up: the still image stays until the code arrives.
   New version: make a release on GitHub, change its version and integrity below, publish. See the README there. */
(function () {
  var BASE = 'https://cdn.jsdelivr.net/gh/alicelegaltech/alice-website-assets@';
  var ORB = '.home-flow_orb, .home-flow-v_orb';   /* where the orb goes: Alice in the homepage's sources diagram */
  var PIECES = [
    { on: '[data-alice-ground]', file: 'v1.1.0/ground/alice-ground.min.js',
      integrity: 'sha384-ckF9OkUmze1K2XUrHHmRe3sVVSNRlZIZ7qcBwXoQx6t9HS2pFKh3Ow6/rUQohuRb',
      data: { fps: '30' } },  /* frames a second: 30 or 60 */
    { on: ORB, file: 'v1.2.0/orb/alice-orb.min.js',
      integrity: 'sha384-QtRmvHKZFSYIGp7S8iJZzsUP0e7m1S6G04mWsJZ8cEiLSQkv9S54S8ABNrqsOj5z',
      data: { targets: ORB, sync: '.pl:not(.out)', fps: '60' } }   /* sync: the lines whose light it follows */
  ];
  var done = false;
  function go() {
    if (done) return;
    done = true;
    PIECES.forEach(function (p) {
      if (!document.querySelector(p.on)) return;
      var s = document.createElement('script');
      s.src = BASE + p.file;
      s.integrity = p.integrity;
      s.crossOrigin = 'anonymous';
      for (var k in p.data) s.setAttribute('data-' + k, p.data[k]);
      document.body.appendChild(s);
    });
  }
  if (document.readyState === 'complete') go();
  else { window.addEventListener('load', go); setTimeout(go, 8000); }
})();
</script>
```

Each piece has a line in `PIECES`: the elements it is for (`on`), its file at a release (`file`), and that file's `integrity`, so the browser only runs the exact file that was released. `data` puts attributes on the script tag. `ORB` lists the elements that get an orb; the orb's script gets the same list (`targets`), so it is written once. A new piece (the mockup, next) gets its own line.

Each piece keeps the release it last changed in: the gradient's file is the same in v1.2.0 as in v1.1.0, so its line can stay at v1.1.0.

**Images don't come from here.** Webflow serves them with the rest of the site: each piece's images are uploaded to Webflow's Assets, and this repository keeps the originals and the tools that make them.

## Shipping a change

1. Change the code here and raise the version (each piece's README says how to build it).
2. Commit, then make a release with a new tag (`v1.1.0`, `v1.2.0`, …).
3. Open the new file's jsDelivr link once, so jsDelivr has it, e.g. `https://cdn.jsdelivr.net/gh/alicelegaltech/alice-website-assets@v1.1.0/ground/alice-ground.min.js`.
4. In the loader, change the version in `file` and the `integrity` (the piece's README gives it). If images changed, upload the new ones to Webflow's Assets and swap them in.
5. Publish the site.

Each piece's README lists its versions.
