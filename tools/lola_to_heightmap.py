#!/usr/bin/env python3
"""
Convert NASA LOLA south-pole elevation GeoTIFFs into the simulator's terrain files.

Writes four files into --out (default: data/):
    regional.json + regional.bin   80 km square around the target (default 513 x 513)
    site.json     + site.bin       4 km square around the target   (default 1025 x 1025)

Each .bin is little-endian float32, row-major, row 0 = most negative map y.
Heights are metres relative to the target point (target = 0), with the target's
elevation above the 1737.4 km reference sphere stored in the .json.

Where to get the data (all free, NASA PGDA, Goddard):
  * Regional mosaic, ~20 m/px:  https://pgda.gsfc.nasa.gov/products/81   (South Pole LOLA DEM Mosaic)
                                https://pgda.gsfc.nasa.gov/products/90   (A New View of the Lunar South Pole)
  * Landing sites, 5 m/px:      https://pgda.gsfc.nasa.gov/products/78   (High-Resolution LOLA Topography
                                                                          for Lunar South Pole Sites)
Download a GeoTIFF of each (the .tif versions, not .img). Pick your target's
latitude/longitude by clicking it in LROC QuickMap (https://quickmap.lroc.asu.edu).

Usage:
    pip install rasterio pyproj numpy scipy
    python tools/lola_to_heightmap.py \
        --regional LDEM_80S_20M.tif --site site_5m.tif \
        --lat -89.45 --lon 222.7 --heading 0 --name "My landing site"

    # one file is fine too (it is used for both levels):
    python tools/lola_to_heightmap.py --regional mosaic.tif --lat ... --lon ...

Then either drop the four files into the sim's setup screen ("Load LOLA
heightmap files"), or put them in data/ next to index.html.
"""
import argparse, json, math, os, sys

import numpy as np

MOON_R = 1737400.0


def die(msg):
    sys.exit(f"error: {msg}")


def open_raster(path):
    try:
        import rasterio
    except ImportError:
        die("needs rasterio: pip install rasterio pyproj numpy scipy")
    ds = rasterio.open(path)
    band = ds.read(1, masked=True).astype("float64")
    data = band.filled(np.nan)
    scale = ds.scales[0] if ds.scales and ds.scales[0] else 1.0
    offset = ds.offsets[0] if ds.offsets and ds.offsets[0] else 0.0
    data = data * scale + offset
    finite = data[np.isfinite(data)]
    if finite.size and np.nanmax(np.abs(finite)) < 30:
        print(f"  {os.path.basename(path)}: values look like kilometres, converting to metres")
        data *= 1000.0
    return ds, data


def raster_crs(ds):
    from pyproj import CRS
    if ds.crs:
        return CRS.from_user_input(ds.crs.to_wkt())
    print("  no CRS in file; assuming Moon south polar stereographic, R = 1737.4 km")
    return CRS.from_proj4(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={MOON_R} +units=m +no_defs")


def target_xy(ds, lat, lon):
    from pyproj import CRS, Transformer
    crs = raster_crs(ds)
    geo = CRS.from_proj4(f"+proj=longlat +R={MOON_R} +no_defs")
    t = Transformer.from_crs(geo, crs, always_xy=True)
    return t.transform(lon, lat)


def resample(ds, data, cx, cy, span, size, heading_deg):
    """Sample a size x size grid, span metres across, centred on (cx, cy) in raster CRS."""
    from scipy.ndimage import map_coordinates
    half = span / 2.0
    lin = np.linspace(-half, half, size)
    mx, my = np.meshgrid(lin, lin)              # map coords; row 0 = most negative y
    h = math.radians(heading_deg)
    gx = cx + mx * math.cos(h) - my * math.sin(h)
    gy = cy + mx * math.sin(h) + my * math.cos(h)
    inv = ~ds.transform
    col, row = inv * (gx, gy)
    out = map_coordinates(data, [row - 0.5, col - 0.5], order=1, mode="nearest", cval=np.nan)
    if np.isnan(out).any():
        frac = np.isnan(out).mean()
        print(f"  warning: {frac:.1%} of samples fall outside valid data; filling with the mean")
        out = np.where(np.isnan(out), np.nanmean(out), out)
    return out


def write(out_dir, name, grid, span, meta):
    size = grid.shape[0]
    bin_name = f"{name}.bin"
    grid.astype("<f4").tofile(os.path.join(out_dir, bin_name))
    header = {"name": name, "size": size, "spacing": span / (size - 1), "bin": bin_name, **meta}
    with open(os.path.join(out_dir, f"{name}.json"), "w") as f:
        json.dump(header, f, indent=2)
    print(f"  wrote {name}.json/.bin: {size}x{size}, {header['spacing']:.2f} m/px, "
          f"relief {grid.min():.0f} .. {grid.max():.0f} m")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--regional", required=True, help="GeoTIFF covering at least 80 km around the target")
    ap.add_argument("--site", help="higher-resolution GeoTIFF covering 4 km around the target (optional)")
    ap.add_argument("--lat", type=float, required=True, help="target latitude, degrees (negative = south)")
    ap.add_argument("--lon", type=float, required=True, help="target longitude, degrees east")
    ap.add_argument("--heading", type=float, default=0.0,
                    help="approach direction in the raster grid, degrees CCW from grid +x (default 0)")
    ap.add_argument("--name", default="LOLA landing site", help="label shown in the sim")
    ap.add_argument("--regional-span", type=float, default=80000)
    ap.add_argument("--regional-size", type=int, default=513)
    ap.add_argument("--site-span", type=float, default=4000)
    ap.add_argument("--site-size", type=int, default=1025)
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    print("regional:", a.regional)
    rds, rdata = open_raster(a.regional)
    rcx, rcy = target_xy(rds, a.lat, a.lon)
    reg = resample(rds, rdata, rcx, rcy, a.regional_span, a.regional_size, a.heading)

    if a.site:
        print("site:", a.site)
        sds, sdata = open_raster(a.site)
        scx, scy = target_xy(sds, a.lat, a.lon)
        site = resample(sds, sdata, scx, scy, a.site_span, a.site_size, a.heading)
        site_src = os.path.basename(a.site)
    else:
        site = resample(rds, rdata, rcx, rcy, a.site_span, a.site_size, a.heading)
        site_src = os.path.basename(a.regional)

    c = a.site_size // 2
    target_elev = float(site[c, c])
    reg -= target_elev
    site -= target_elev
    common = {"source": "NASA LOLA", "siteName": a.name, "lat": a.lat, "lon": a.lon,
              "heading": a.heading, "targetElevation": target_elev}
    write(a.out, "regional", reg, a.regional_span, {**common, "file": os.path.basename(a.regional)})
    write(a.out, "site", site, a.site_span, {**common, "file": site_src})
    print(f"target elevation {target_elev:.1f} m above the 1737.4 km sphere. Done.")


if __name__ == "__main__":
    main()
