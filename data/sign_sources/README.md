# Sign artwork source

`barefoot-logo.png` is the public Barefoot Campus Outfitter mark served by the
brand's own website, retrieved September 22, 2026:

https://www.barefootcampusoutfitter.com/cdn/shop/files/BF_Navy_Logo.png?v=1767712065&width=1400

The geometry generator contours the upper mark (word, feet and wings) into
curved solid lettering and a backing plaque. The lower tagline is excluded
because the storefront has separate lettering. No owner photograph is used
as a texture or included in this asset. The mark identifies the actual shop;
it does not imply endorsement.

The other cached signs contain solid word outlines, not raster textures.
`wingstop` uses serif `WING·STOP` with its separate center dot; `miss-behavin`
uses condensed sans-serif capitals. `sandwich-works` is a separate condensed
capital line. These are lettering approximations from locally installed fonts,
not official vector brand files. Font files are never included.

`potbelly` reconstructs the classic oversized, curled P and Y with smooth
Bezier outlines and uses condensed serif interior capitals. It is an authored
approximation of the classic storefront lettering, not the newer rounded
wordmark and not an official downloaded logo. No photograph is included or
sampled as a facade texture. The source script contains the original curves.

Regenerate just these four words while preserving every existing cached outline:

```powershell
python scripts/sign_outlines.py --font-dir C:\Windows\Fonts --add-only
```
