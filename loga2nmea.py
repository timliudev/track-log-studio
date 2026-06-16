#!/usr/bin/env python3
"""Convert .loga ECU log files (Super2 / SuperX formats) to RaceChrono DIY .nmea
(mixed NMEA0183 $GPRMC + RaceChrono $RC3 sentences)."""

import sys
import re
import math
import datetime
from pathlib import Path

ALIASES = {
    "AFR": ["AFR", "AFR_WBO2"],
    "Volt_Batt": ["Volt_Batt", "Volt_Batt_indx"],
}

REQUIRED = [
    "RPM", "TPS_Percent", "T_Eng", "Vehicle_Speed", "GPS_Speed",
    "AFR", "GearNum", "TC_Lean_Angle", "Volt_Batt",
    "TC_Xforce", "TC_Yforce", "TC_Zforce",
    "GPS_UTC_hh", "GPS_UTC_mm", "GPS_UTC_ss", "GPS_UTC_ms",
    "GPS_Valid", "GPS_Lat_deg", "GPS_Lat_min", "GPS_Lat_mmmm", "GPS_Lat_NS",
    "GPS_Lon_deg", "GPS_Lon_min", "GPS_Lon_mmmm", "GPS_Lon_EW",
]


def parse_created_date(line):
    value = line.split(":", 1)[1].strip()
    for fmt in ("%Y/%m/%d %H:%M:%S", "%m/%d/%Y %I:%M:%S %p"):
        try:
            return datetime.datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def build_index(names):
    idx = {}
    for i, raw in enumerate(names):
        canonical = raw.split("/")[0].strip()
        idx[canonical] = i
    return idx


def resolve(idx, canonical):
    candidates = ALIASES.get(canonical, [canonical])
    for c in candidates:
        if c in idx:
            return idx[c]
    return None


def load_super2(lines):
    created = None
    for l in lines[:5]:
        if l.startswith("Creased Date") or l.startswith("Created Date"):
            created = parse_created_date(l)
    header = lines[5].split(",")
    idx = build_index(header)
    data_lines = lines[6:]
    return idx, data_lines, created


def load_superx(lines):
    created = None
    name_line_no = None
    data_start_no = None
    for i, l in enumerate(lines):
        if l.startswith("Created Date"):
            created = parse_created_date(l)
        if l.strip() == "<VAR NAME>":
            name_line_no = i + 1
        if l.strip() == "<DATA START>":
            data_start_no = i + 1
    header = lines[name_line_no].split(",")
    idx = build_index(header)
    data_lines = lines[data_start_no:]
    return idx, data_lines, created


def nmea_checksum(body):
    cs = 0
    for ch in body:
        cs ^= ord(ch)
    return f"{cs:02X}"


def make_sentence(body):
    return f"${body}*{nmea_checksum(body)}\r\n"


def fmt(v, decimals=3):
    return f"{v:.{decimals}f}"


def bearing_deg(lat1, lon1, lat2, lon2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlon)
    theta = math.degrees(math.atan2(y, x))
    return (theta + 360.0) % 360.0


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# Below this displacement between the two ends of a heading-window, GPS noise
# dominates and a freshly computed bearing is unreliable, so the previous
# heading is carried forward instead.
MIN_MOVE_M = 1.0

# Half-width (in valid-fix samples) of the baseline used for each raw bearing
# estimate. A wider baseline averages out point-to-point GPS jitter, which is
# what makes corner headings choppy with a naive consecutive-point bearing.
HEADING_HALF_WINDOW = 4

# Smoothing factor for the forward/backward exponential moving average over
# heading unit vectors. Lower = smoother but more lag; combining a forward
# and backward pass cancels the lag while keeping the corner transitions
# continuous instead of jumping between samples.
HEADING_EMA_ALPHA = 0.25


def compute_smoothed_courses(lat_dd_list, lon_dd_list):
    n = len(lat_dd_list)
    if n == 0:
        return []
    if n == 1:
        return [0.0]

    raw = []
    last_raw = 0.0
    for i in range(n):
        j0 = max(0, i - HEADING_HALF_WINDOW)
        j1 = min(n - 1, i + HEADING_HALF_WINDOW)
        if j0 == j1:
            raw.append(last_raw)
            continue
        moved = haversine_m(lat_dd_list[j0], lon_dd_list[j0], lat_dd_list[j1], lon_dd_list[j1])
        if moved >= MIN_MOVE_M:
            last_raw = bearing_deg(lat_dd_list[j0], lon_dd_list[j0], lat_dd_list[j1], lon_dd_list[j1])
        raw.append(last_raw)

    vectors = [complex(math.cos(math.radians(a)), math.sin(math.radians(a))) for a in raw]

    def ema(seq, alpha):
        out = []
        s = None
        for v in seq:
            s = v if s is None else (alpha * v + (1 - alpha) * s)
            out.append(s)
        return out

    forward = ema(vectors, HEADING_EMA_ALPHA)
    backward = list(reversed(ema(list(reversed(vectors)), HEADING_EMA_ALPHA)))

    smoothed = []
    for f, b in zip(forward, backward):
        c = f + b
        if abs(c) < 1e-9:
            c = f
        smoothed.append(math.degrees(math.atan2(c.imag, c.real)) % 360.0)
    return smoothed


def convert(path: Path):
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    if lines[0].strip().startswith("<Cycling Memory Log Data"):
        idx, data_lines, created = load_super2(lines)
    elif lines[0].strip().startswith("<aRacerX Memory Log File>"):
        idx, data_lines, created = load_superx(lines)
    else:
        raise ValueError(f"Unrecognized .loga format: {path}")

    missing = [name for name in REQUIRED if resolve(idx, name) is None]
    if missing:
        print(f"[{path.name}] warning: missing columns, will be left blank: {missing}", file=sys.stderr)

    col = {name: resolve(idx, name) for name in REQUIRED}

    date_str = created.strftime("%d%m%y") if created else "010100"

    # Pass 1: parse every row's fields once and collect the GPS fixes so the
    # heading can be smoothed over the whole sequence before emitting output.
    parsed_rows = []
    fix_lat, fix_lon = [], []

    for raw in data_lines:
        raw = raw.strip()
        if not raw:
            continue
        fields = raw.split(",")

        def get(name, default=0.0, fields=fields):
            i = col.get(name)
            if i is None or i >= len(fields):
                return default
            try:
                return float(fields[i])
            except ValueError:
                return default

        gps_valid_code = int(get("GPS_Valid", 0))
        valid_char = chr(gps_valid_code) if gps_valid_code else None

        row = {"get": get, "valid": valid_char == "A", "fix_idx": None}

        if row["valid"]:
            lat_deg = int(get("GPS_Lat_deg"))
            lat_min = get("GPS_Lat_min") + get("GPS_Lat_mmmm") / 10000.0
            lat_ns = chr(int(get("GPS_Lat_NS")))
            lon_deg = int(get("GPS_Lon_deg"))
            lon_min = get("GPS_Lon_min") + get("GPS_Lon_mmmm") / 10000.0
            lon_ew = chr(int(get("GPS_Lon_EW")))

            lat_dd = lat_deg + lat_min / 60.0
            if lat_ns == "S":
                lat_dd = -lat_dd
            lon_dd = lon_deg + lon_min / 60.0
            if lon_ew == "W":
                lon_dd = -lon_dd

            row["lat_deg"] = lat_deg
            row["lat_min"] = lat_min
            row["lat_ns"] = lat_ns
            row["lon_deg"] = lon_deg
            row["lon_min"] = lon_min
            row["lon_ew"] = lon_ew
            row["fix_idx"] = len(fix_lat)
            fix_lat.append(lat_dd)
            fix_lon.append(lon_dd)

        parsed_rows.append(row)

    smoothed_courses = compute_smoothed_courses(fix_lat, fix_lon)

    # Pass 2: emit sentences, using the precomputed smoothed heading per fix.
    out_lines = []
    started = False
    skipped = 0
    written = 0

    for row in parsed_rows:
        get = row["get"]

        if not row["valid"]:
            if not started:
                skipped += 1
                continue
            # once started, keep emitting RC3 even if a fix briefly drops,
            # but skip GPRMC for that sample
            gprmc = None
            time_str = ""
        else:
            started = True
            hh = int(get("GPS_UTC_hh"))
            mm = int(get("GPS_UTC_mm"))
            ss = int(get("GPS_UTC_ss"))
            ms = int(get("GPS_UTC_ms"))
            time_str = f"{hh:02d}{mm:02d}{ss:02d}.{ms:03d}"

            course = smoothed_courses[row["fix_idx"]]
            speed_knots = get("GPS_Speed") * 0.539957

            gprmc_body = (
                f"GPRMC,{time_str},A,"
                f"{row['lat_deg']:02d}{row['lat_min']:07.4f},{row['lat_ns']},"
                f"{row['lon_deg']:03d}{row['lon_min']:07.4f},{row['lon_ew']},"
                f"{fmt(speed_knots, 2)},{fmt(course, 1)},{date_str},,,A"
            )
            gprmc = make_sentence(gprmc_body)

        if not started:
            continue

        valid_char = "A" if row["valid"] else None
        xacc = get("TC_Xforce") / 1000.0
        yacc = get("TC_Yforce") / 1000.0
        zacc = get("TC_Zforce") / 1000.0
        rpm = get("RPM")
        a1 = get("TPS_Percent")
        a2 = get("T_Eng")
        a3 = get("Vehicle_Speed")
        a4 = get("GPS_Speed")
        a5 = get("AFR")
        a6 = get("GearNum")
        a7 = get("TC_Lean_Angle")
        a8 = get("Volt_Batt")

        rc3_time = time_str if valid_char == "A" else ""
        rc3_body = (
            f"RC3,{rc3_time},,"
            f"{fmt(xacc)},{fmt(yacc)},{fmt(zacc)},,,,"
            f"{fmt(rpm,1)},,"
            f"{fmt(a1,1)},{fmt(a2,1)},{fmt(a3,1)},{fmt(a4,1)},{fmt(a5,2)},{fmt(a6,0)},{fmt(a7,2)},{fmt(a8,2)}"
        )
        rc3 = make_sentence(rc3_body)

        if gprmc:
            out_lines.append(gprmc)
        out_lines.append(rc3)
        written += 1

    out_path = path.with_suffix(".nmea")
    out_path.write_text("".join(out_lines), encoding="ascii", newline="")
    print(f"[{path.name}] -> {out_path.name}: {written} samples written, {skipped} samples skipped before first GPS fix")


def main():
    if len(sys.argv) < 2:
        print("usage: loga2nmea.py <file.loga> [more.loga ...]")
        sys.exit(1)
    for arg in sys.argv[1:]:
        convert(Path(arg))


if __name__ == "__main__":
    main()
