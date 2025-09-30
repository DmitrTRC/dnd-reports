#!/usr/bin/env python3
"""
Console utility to generate a monthly report PDF for the volunteer militia.

This script reads two JSON files: one containing constant fields (organisation
name, municipality, team name, commander and small header lines) and another
containing variable data for a specific month (month name, year and a list
of activities).  It then produces a professionally formatted A4 PDF
according to a fixed layout.  All font sizes, margins and line spacing
are constant across pages to ensure visual consistency.

Usage::

    python generate_report.py --input data.json --constants constants.json \
        --logo emblem.png --output report.pdf

You can optionally provide a configuration JSON via ``--config`` to
override layout parameters such as margins and colours.
"""

import argparse
import json
import textwrap
from dataclasses import dataclass, field
from typing import List, Optional

import matplotlib
matplotlib.use('Agg')  # ensure non‑interactive backend
import matplotlib.pyplot as plt
from PIL import Image


@dataclass
class ReportConfig:
    """Holds configuration parameters controlling the PDF layout.

    All numerical values are expressed as fractions of the page
    height or width.  Colours are stored in a nested dictionary.  You
    can override these values by passing a JSON file to ``--config``.

    Note on header text lengths:
      • The two lines of ``small_lines`` shown at the very top of
        the header bar are wrapped to approximately 60 characters.
        If the text is significantly longer, it will wrap onto
        additional lines which in turn increases the vertical size
        of the small text region and may overlap subsequent
        elements.  To maintain a clean layout, keep each small
        header line under about 60–65 characters.
      • The organisation name is split across a maximum of two
        lines.  Extremely long organisation names may wrap awkwardly
        or overlap with the logo.
      • Activity descriptions and subitems are wrapped to a width of
        roughly 80 characters.  Very long sentences will be broken
        into multiple lines automatically.
    """
    # Margins and header sizes
    top_margin: float = 0.015
    header_height: float = 0.27
    small_header_factor: float = 0.6  # fraction of header_height used on pages after the first
    bottom_margin: float = 0.03

    # Logo size relative to page width
    logo_width_fraction: float = 0.18

    # Line height for activity list (constant spacing)
    line_height: float = 0.02

    # Offsets for organisation and header lines relative to the header height
    org_line1_offset: float = 0.23
    org_line2_offset: float = 0.38
    station_line_offset: float = 0.32
    team_line_offset: float = 0.22

    # Colours used in the layout
    colours: dict = field(default_factory=lambda: {
        'green_dark': '#0B4F37',
        'accent_yellow': '#F6C744',
        'header_text': '#E8F5E9',
        'small_text': '#8FAF98',
        'subheader_green': '#007E2B',
        'body_text': '#212121',
        'red': '#C62828',
    })

    # The following values control how the small header lines (``small_lines``)
    # are distributed within the coloured header bar.  The value
    # ``small_lines_start`` expresses the fraction of ``header_height`` at
    # which the first small line begins counting from the top of the
    # header.  ``small_lines_reserved`` specifies the fraction of
    # ``header_height`` reserved for the entire block of small lines.
    # If more lines are provided than comfortably fit within this
    # reserved space the spacing between them will be reduced
    # proportionally.  You can override these values via a config file
    # if your header text is unusually long.  See ``_wrap_small_lines``
    # for the recommended maximum length per line.
    small_lines_start: float = 0.03
    small_lines_reserved: float = 0.20

    @staticmethod
    def load(path: str) -> 'ReportConfig':
        """Load configuration overrides from a JSON file."""
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        cfg = ReportConfig()
        for key, value in data.items():
            if hasattr(cfg, key):
                if key == 'colours' and isinstance(value, dict):
                    cfg.colours.update(value)
                else:
                    setattr(cfg, key, value)
        return cfg


@dataclass
class Activity:
    """Represents a single activity with optional subpoints."""
    text: str
    subitems: List[str] = field(default_factory=list)


@dataclass
class ReportData:
    """Structured container for report data."""
    month: str
    year: int
    organization: str
    station: str
    team_name: str
    commander: str
    activities: List[Activity]
    small_lines: List[str] = field(default_factory=list)


def parse_report_data(data: dict) -> ReportData:
    """Build a ReportData instance from a dictionary."""
    activities: List[Activity] = []
    for item in data.get('activities', []):
        text = item.get('text', '').strip()
        subitems = item.get('subitems') or []
        activities.append(Activity(text=text, subitems=subitems))
    small_lines = data.get('small_lines', [])
    return ReportData(
        month=data['month'],
        year=int(data['year']),
        organization=data['organization'],
        station=data['station'],
        team_name=data['team_name'],
        commander=data['commander'],
        activities=activities,
        small_lines=small_lines,
    )


class ReportGenerator:
    """Generates a PDF report from supplied data and a logo."""

    def __init__(self, logo_path: str, config: Optional[ReportConfig] = None) -> None:
        # Load logo and crop transparent border
        img = Image.open(logo_path).convert('RGBA')
        alpha = img.split()[-1]
        bbox = alpha.getbbox()
        if bbox:
            img = img.crop(bbox)
        w, h = img.size
        if w != h:
            side = max(w, h)
            sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
            sq.paste(img, ((side - w) // 2, (side - h) // 2))
            img = sq
        self.logo = img
        # Apply configuration
        self.cfg = config or ReportConfig()
        colours = self.cfg.colours
        self._GREEN_DARK = colours['green_dark']
        self._ACCENT_YELLOW = colours['accent_yellow']
        self._HEADER_TEXT = colours['header_text']
        self._SMALL_TEXT = colours['small_text']
        self._SUBHEADER_GREEN = colours['subheader_green']
        self._BODY_TEXT = colours['body_text']
        self._RED = colours['red']

    def _wrap_small_lines(self, lines: List[str]) -> List[str]:
        """Wrap small header lines to avoid overflowing the header."""
        wrapper = textwrap.TextWrapper(width=60)
        out: List[str] = []
        for line in lines:
            out.extend(wrapper.wrap(line))
        return out

    def generate(self, report: ReportData, output_path: str) -> None:
        """Generate a multi‑page PDF report."""
        cfg = self.cfg
        # Flatten activities into a list of (indent_level, lines)
        flat_lines: List[tuple[int, str]] = []
        wrapper = textwrap.TextWrapper(width=80)
        for idx, act in enumerate(report.activities, start=1):
            main_lines = wrapper.wrap(act.text)
            if main_lines:
                main_lines[0] = f"{idx}. " + main_lines[0]
            flat_lines.extend([(0, line) for line in main_lines])
            for s_idx, sub in enumerate(act.subitems or [], start=1):
                sub_lines = wrapper.wrap(sub)
                if sub_lines:
                    sub_lines[0] = f"{s_idx}) " + sub_lines[0]
                flat_lines.extend([(1, line) for line in sub_lines])
        total_lines = len(flat_lines)
        small_lines_wrapped = self._wrap_small_lines(report.small_lines)
        # Pre‑compute a global number of lines per page based on the smallest available height
        # on the first and subsequent pages.  This ensures consistent vertical density across all pages.
        header_top1 = 1.0 - cfg.top_margin
        header_bottom1 = header_top1 - cfg.header_height
        body_top1 = header_bottom1 - 0.02
        sub_y1 = body_top1 - 0.06
        y_start_first = sub_y1 - 0.08
        available_first = y_start_first - cfg.bottom_margin
        # Small header for pages beyond the first
        header_height_small = cfg.header_height * cfg.small_header_factor
        header_bottom_small = header_top1 - header_height_small
        y_start_other = header_bottom_small - 0.02
        available_other = y_start_other - cfg.bottom_margin
        # Determine minimum available height and compute lines per page
        # Use the smallest available vertical space across the first and
        # subsequent pages to determine how many lines fit on any page.
        min_available = min(available_first, available_other)
        # At least one line must fit; using int() truncates to the
        # greatest whole number of lines that fit into the available space.
        lines_per_page_global = max(int(min_available // cfg.line_height), 1)
        # Start creating pages
        from matplotlib.backends.backend_pdf import PdfPages
        current_index = 0
        page_number = 0
        with PdfPages(output_path) as pdf:
            while current_index < total_lines or page_number == 0:
                page_number += 1
                fig = plt.figure(figsize=(8.27, 11.69))
                ax = fig.add_axes([0, 0, 1, 1])
                ax.axis('off')
                # Compute header geometry
                header_top = 1.0 - cfg.top_margin
                header_height = cfg.header_height if page_number == 1 else cfg.header_height * cfg.small_header_factor
                header_bottom = header_top - header_height
                # Draw header bar
                ax.add_patch(
                    plt.Rectangle((0, header_bottom), 1, header_height, color=self._GREEN_DARK, transform=ax.transAxes)
                )
                # Small lines within header
                if small_lines_wrapped:
                    # Dynamically distribute wrapped small lines within a reserved portion of the header.
                    # The start and reserved fractions can be overridden via ReportConfig (see comments
                    # on ``small_lines_start`` and ``small_lines_reserved``).  A larger list of lines
                    # will reduce the distance between lines proportionally.  If your small header
                    # contains more than roughly 60–65 characters per line or too many lines, consider
                    # shortening them in ``report_constants.json`` or increasing
                    # ``small_lines_reserved`` in the config.
                    start_frac_small = cfg.small_lines_start
                    reserved_frac_small = cfg.small_lines_reserved
                    n = len(small_lines_wrapped)
                    # Prevent division by zero – if no small lines are provided nothing is drawn.
                    if n > 0:
                        spacing_frac = reserved_frac_small / n
                        for i, line in enumerate(small_lines_wrapped):
                            y = header_top - (start_frac_small + i * spacing_frac) * header_height
                            ax.text(0.06, y, line, fontsize=7.5, color=self._SMALL_TEXT,
                                    ha='left', va='top', transform=ax.transAxes)
                # Prepare organisation title (split after first space)
                org = report.organization.strip()
                title_text = org.replace(' ', '\n', 1) if ' ' in org else org
                # Positions for header lines.  Note that ``org_y2`` is
                # intentionally omitted because the organisation name is
                # rendered using a single call to ``ax.text`` with an embedded
                # newline.  Having two separate y‑coordinates from an earlier
                # implementation is therefore unnecessary and could cause
                # confusion.  Station and team lines are anchored relative
                # to the bottom of the header so that changes to header
                # height propagate consistently across pages.
                org_y1 = header_top - cfg.org_line1_offset * header_height
                station_y = header_bottom + cfg.station_line_offset * header_height
                team_y = header_bottom + cfg.team_line_offset * header_height
                if page_number == 1:
                    # Draw organisation, station and team lines
                    ax.text(0.06, org_y1, title_text, fontsize=34, color=self._ACCENT_YELLOW,
                            fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                    ax.text(0.06, station_y, report.station, fontsize=13, color=self._HEADER_TEXT,
                            ha='left', va='top', transform=ax.transAxes)
                    ax.text(0.06, team_y, report.team_name, fontsize=13, color=self._HEADER_TEXT,
                            ha='left', va='top', transform=ax.transAxes)
                    # Draw logo
                    logo_aspect = self.logo.width / (self.logo.height * 0.83)
                    logo_w = cfg.logo_width_fraction
                    logo_h = logo_w / logo_aspect
                    logo_x = 1 - 0.06 - logo_w
                    logo_y = header_bottom + (header_height - logo_h) / 2
                    ax.imshow(self.logo, extent=(logo_x, logo_x + logo_w, logo_y, logo_y + logo_h),
                              transform=ax.transAxes, zorder=1)
                    # Report title and section heading
                    body_top = header_bottom - 0.02
                    title_y = body_top
                    sub_y = body_top - 0.06
                    ax.text(0.06, title_y, f'Отчёт за {report.month} {report.year}', fontsize=24,
                            color=self._SUBHEADER_GREEN, fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                    ax.text(0.06, sub_y, f'За {report.month} {report.year} проведено:', fontsize=18,
                            color=self._RED, fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                    y_start = sub_y - 0.08  # start of list after headings
                else:
                    # Draw only the organisation name on subsequent pages
                    ax.text(0.06, org_y1, title_text, fontsize=34, color=self._ACCENT_YELLOW,
                            fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                    y_start = header_bottom - 0.02
                # Determine how many list lines fit on this page (use global lines_per_page)
                lines_remaining = total_lines - current_index
                lines_this_page = min(lines_remaining, lines_per_page_global)
                # Draw list lines
                list_y = y_start
                for i in range(lines_this_page):
                    indent, text = flat_lines[current_index + i]
                    x_pos = 0.06 + 0.02 * indent
                    ax.text(x_pos, list_y, text, fontsize=11, color=self._BODY_TEXT,
                            ha='left', va='top', transform=ax.transAxes)
                    list_y -= cfg.line_height
                current_index += lines_this_page
                # If all lines are drawn, add signature on the last page
                if current_index >= total_lines:
                    # Attempt to place signature on this page if there is space below the last line
                    sig_required_height = 0.07
                    if (list_y - sig_required_height) > cfg.bottom_margin:
                        sig_y = list_y - 0.05
                        if sig_y < 0.08:
                            sig_y = 0.08
                        ax.text(0.06, sig_y, 'Командир Добровольной Народной Дружины:', fontsize=13,
                                color=self._BODY_TEXT, fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                        ax.text(0.06, sig_y - 0.03, report.commander, fontsize=13, color=self._BODY_TEXT,
                                ha='left', va='top', transform=ax.transAxes)
                    else:
                        # Create an extra page for the signature
                        pdf.savefig(fig)
                        plt.close(fig)
                        fig = plt.figure(figsize=(8.27, 11.69))
                        ax = fig.add_axes([0, 0, 1, 1])
                        ax.axis('off')
                        header_top2 = 1.0 - cfg.top_margin
                        header_height2 = cfg.header_height * cfg.small_header_factor
                        header_bottom2 = header_top2 - header_height2
                        ax.add_patch(
                            plt.Rectangle((0, header_bottom2), 1, header_height2, color=self._GREEN_DARK, transform=ax.transAxes)
                        )
                        if small_lines_wrapped:
                            # Dynamically distribute wrapped small lines within the reserved portion
                            start_frac_small = cfg.small_lines_start
                            reserved_frac_small = cfg.small_lines_reserved
                            n = len(small_lines_wrapped)
                            if n > 0:
                                spacing_frac = reserved_frac_small / n
                                for i, line in enumerate(small_lines_wrapped):
                                    y = header_top2 - (start_frac_small + i * spacing_frac) * header_height2
                                    ax.text(0.06, y, line, fontsize=7.5, color=self._SMALL_TEXT,
                                            ha='left', va='top', transform=ax.transAxes)
                        ax.text(0.06, header_top2 - cfg.org_line1_offset * header_height2, title_text, fontsize=34,
                                color=self._ACCENT_YELLOW, fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                        sig_y2 = header_bottom2 - 0.1
                        ax.text(0.06, sig_y2, 'Командир Добровольной Народной Дружины:', fontsize=13,
                                color=self._BODY_TEXT, fontweight='bold', ha='left', va='top', transform=ax.transAxes)
                        ax.text(0.06, sig_y2 - 0.03, report.commander, fontsize=13, color=self._BODY_TEXT,
                                ha='left', va='top', transform=ax.transAxes)
                        pdf.savefig(fig)
                        plt.close(fig)
                        continue
                pdf.savefig(fig)
                plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate a PDF report for the volunteer militia.')
    parser.add_argument('-i', '--input', required=True, help='Path to JSON file with variable report data.')
    parser.add_argument('-C', '--constants', required=False, help='Path to JSON file with constant report fields.')
    parser.add_argument('-l', '--logo', required=True, help='Path to logo PNG with transparent background.')
    parser.add_argument('-o', '--output', default='report.pdf', help='Path to output PDF file.')
    parser.add_argument('-c', '--config', help='Optional path to JSON configuration file.')
    args = parser.parse_args()

    cfg = ReportConfig.load(args.config) if args.config else None
    # Load constants if provided
    consts = {}
    if args.constants:
        with open(args.constants, 'r', encoding='utf-8') as f:
            consts = json.load(f)
    with open(args.input, 'r', encoding='utf-8') as f:
        var_data = json.load(f)
    # Merge constants into variable data if keys are missing
    for k, v in consts.items():
        var_data.setdefault(k, v)
    report_data = parse_report_data(var_data)
    generator = ReportGenerator(args.logo, config=cfg)
    generator.generate(report_data, args.output)
    print(f'Report saved to {args.output}')


if __name__ == '__main__':
    main()
