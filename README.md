# alice-web

Files the alice.law website loads from this repository, through [jsDelivr](https://www.jsdelivr.com/), so they are versioned and cached worldwide.

| Folder | What it is |
|---|---|
| [`ground/`](ground/) | **Alice Ground**, the moving brand gradient behind the hero, the pricing plan and the closing. The script, the still images under it and the grain. See [`ground/README.md`](ground/README.md). |

## Versions

Every release is a tag (`v1.0.0`, `v1.0.1`, …). The website always points at one tag:

```
https://cdn.jsdelivr.net/gh/<owner>/<repo>@v1.0.0/ground/alice-ground.min.js
```

so nothing changes on the site when this repository changes. To ship a change: commit, make a new release with a new tag, point the website at the new tag, publish the site.
