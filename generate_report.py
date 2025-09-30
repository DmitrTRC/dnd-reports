#!/usr/bin/env python3
"""
Console utility to generate a monthly report PDF for the volunteer militia.

The application accepts a JSON file describing the report content (month, year,
activities, etc.) and produces a PDF document formatted according to the
layout developed in the latest design iteration.  The resulting PDF uses
an A4 page (210×297 mm) with a coloured header, organisation and team names,
a shield‑style logo, a section heading, a numbered list of activities with
optional subpoints and a commander signature line.  Colours and fonts are
kept consistent with the previous template.

Usage:

    python generate_report.py --input data.json --output report.pdf \
        --logo emblem.png

If the output file is omitted, it will default to ``report.pdf`` in the
current working directory.  The JSON schema is documented in the
``ReportGenerator.load_data`` docstring.
"""

import argparse
import json
import textwrap
from dataclasses import dataclass, field
from typing import List, Optional, Union

import matplotlib
matplotlib.use('Agg')  # use non‑interactive backend
import matplotlib.pyplot as plt
from PIL import Image


@dataclass
class Activity:
    """Represents an activity in the report.

    Each activity has mandatory text and may optionally contain a list of
    subitems.  Subitems are rendered as lettered points beneath the parent
    activity.
    """

    text: str
    subitems: Optional[List[str]] = field(default_factory=list)


@dataclass
class ReportData:
    """Structured representation of the report data loaded from JSON."""

    month: str
    year: int
    organization: str  # top‑level organisation name (e.g. ПРАВОПОРЯДОК ЛУКОМОРЬЯ)
    station: str       # settlement / station name (e.g. МО Колтушское ...)
    team_name: str     # team name (e.g. Добровольная Народная Дружина)
    commander: str     # commander full name
    activities: List[Activity]
    small_lines: Optional[List[str]] = field(default_factory=list)


class ReportGenerator:
    """Generates a PDF report from structured data using matplotlib.

    This class encapsulates the layout constants and drawing logic.  It
    produces a single‑page A4 document with coloured header, logo, section
    headings, a numbered list of activities and a signature.  All
    measurements are expressed in relative coordinates (0–1), making the
    layout resolution independent.
    """

    # Define palette constants
    _GREEN_DARK = '#0B4F37'
    _ACCENT_YELLOW = '#F6C744'
    _HEADER_TEXT = '#E8F5E9'
    _SMALL_TEXT = '#8FAF98'
    _SUBHEADER_GREEN = '#007E2B'
    _BODY_TEXT = '#212121'
    _RED = '#C62828'

    def __init__(self, logo_path: str) -> None:
        """Initialise the generator with a path to the logo image (PNG).

        The logo should have a transparent background for best results.
        """
        self.logo = Image.open(logo_path).convert('RGBA')

    @staticmethod
    def load_data(path: str) -> ReportData:
        """Load report data from a JSON file.

        The JSON object should contain the following keys:

        - ``month`` (str): Name of the month in genitive case (e.g. "Августа").
        - ``year`` (int): Year number (e.g. 2025).
        - ``organization`` (str): Top‑level organisation name on the header (e.g. "ПРАВОПОРЯДОК ЛУКОМОРЬЯ").
        - ``station`` (str): Settlement/municipality line (e.g. "МО Колтушское городское поселение").
        - ``team_name`` (str): Team name line (e.g. "Добровольная Народная Дружина").
        - ``commander`` (str): Name of the commander to sign the report.
        - ``activities`` (list): List of activity objects.  Each activity
          object must contain a ``text`` field and may optionally contain
          ``subitems`` – a list of strings to render as subpoints.
        - ``small_lines`` (list, optional): Lines of small print to show at
          the top of the document.  If omitted, defaults to an empty list.

        Example::

            {
              "month": "Август",
              "year": 2025,
              "organization": "ПРАВОПОРЯДОК ЛУКОМОРЬЯ",
              "station": "МО Колтушское городское поселение",
              "team_name": "Добровольная Народная Дружина",
              "commander": "Морозов Дмитрий Вадимович",
              "activities": [
                {"text": "Ежедневные дежурства в КП Лукоморье"},
                {"text": "Выявление и предотвращение нарушений:",
                 "subitems": [
                   "Предотвращено 3 попытки незаконного проезда на охраняемую территорию.",
                   "Выявлено 5 случаев распития алкогольных напитков в общественных местах.",
                   "Оказана помощь в поиске двух потерявшихся детей."
                 ]}
              ],
              "small_lines": [
                "Свидетельство ГУ МВД РФ …", "Ленинградская обл. …"
              ]
            }
        """
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        activities = []
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
            small_lines=small_lines
        )

    def generate(self, report: ReportData, output_path: str) -> None:
        """Generate the report PDF at the given path.

        Args:
            report: Parsed report data from JSON.
            output_path: Destination path for the resulting PDF.
        """
        # Configure figure to A4 size (210×297 mm = 8.27×11.69 inch)
        fig = plt.figure(figsize=(8.27, 11.69))
        ax = fig.add_axes([0, 0, 1, 1])
        ax.axis('off')

        # Small text lines near the top (e.g. certificate info)
        y_small = 1 - 0.01
        for line in report.small_lines:
            ax.text(0.06, y_small, line, fontsize=7.5, color=self._SMALL_TEXT,
                    ha='left', va='top', transform=ax.transAxes)
            y_small -= 0.015

        # Header bar
        header_height = 0.28
        ax.add_patch(plt.Rectangle((0, 1 - header_height), 1, header_height,
                                   color=self._GREEN_DARK, transform=ax.transAxes))

        # Main organisation name (two lines if containing a space)
        header_y = 1 - header_height + 0.21
        # Split organisation into two roughly equal lines for better layout
        org_words = report.organization.strip().split()
        if len(org_words) > 2:
            # Split after the first word
            org_line1 = org_words[0]
            org_line2 = ' '.join(org_words[1:])
        else:
            # Otherwise split evenly
            org_line1 = report.organization
            org_line2 = ''
        ax.text(0.06, header_y, org_line1, fontsize=36, color=self._ACCENT_YELLOW,
                fontweight='bold', ha='left', va='top', transform=ax.transAxes)
        if org_line2:
            ax.text(0.06, header_y - 0.075, org_line2, fontsize=36,
                    color=self._ACCENT_YELLOW, fontweight='bold', ha='left',
                    va='top', transform=ax.transAxes)

        # Station and team name lines
        sub_y = header_y - 0.15
        ax.text(0.06, sub_y, report.station, fontsize=13, color=self._HEADER_TEXT,
                ha='left', va='top', transform=ax.transAxes)
        ax.text(0.06, sub_y - 0.037, report.team_name, fontsize=13,
                color=self._HEADER_TEXT, ha='left', va='top', transform=ax.transAxes)

        # Logo placement on the right
        logo_aspect = self.logo.width / self.logo.height
        logo_width_frac = 0.24
        logo_height_frac = logo_width_frac / logo_aspect
        logo_left = 1 - 0.06 - logo_width_frac + 0.02  # shift slightly right
        logo_bottom = 1 - header_height + (header_height - logo_height_frac) / 2
        ax.imshow(self.logo, extent=(logo_left, logo_left + logo_width_frac,
                                     logo_bottom, logo_bottom + logo_height_frac),
                  transform=ax.transAxes, zorder=1)

        # Body: report title and section heading
        body_y = 1 - header_height - 0.05
        ax.text(0.06, body_y,
                f'Отчёт за {report.month} {report.year}',
                fontsize=24, color=self._SUBHEADER_GREEN,
                fontweight='bold', ha='left', va='top', transform=ax.transAxes)
        section_y = body_y - 0.08
        ax.text(0.06, section_y,
                f'За {report.month} {report.year} проведено:',
                fontsize=18, color=self._RED, fontweight='bold',
                ha='left', va='top', transform=ax.transAxes)

        # Activities list
        current_y = section_y - 0.05
        item_idx = 1
        for act in report.activities:
            # Prefix for main item
            prefix = f"{item_idx}. " if act.subitems else f"{item_idx}. "
            # Wrap main text
            wrapper = textwrap.TextWrapper(width=80)
            lines = wrapper.wrap(act.text)
            if lines:
                lines[0] = prefix + lines[0]
            for line in lines:
                ax.text(0.06, current_y, line, fontsize=12, color=self._BODY_TEXT,
                        ha='left', va='top', transform=ax.transAxes)
                current_y -= 0.029
            # Subitems if any
            if act.subitems:
                sub_counter = 1
                for sub in act.subitems:
                    sub_prefix = f"{sub_counter}) "
                    sub_lines = wrapper.wrap(sub)
                    if sub_lines:
                        sub_lines[0] = sub_prefix + sub_lines[0]
                    for sline in sub_lines:
                        ax.text(0.08, current_y, sline, fontsize=12,
                                color=self._BODY_TEXT, ha='left', va='top',
                                transform=ax.transAxes)
                        current_y -= 0.029
                    sub_counter += 1
            item_idx += 1

        # Signature block near bottom
        sig_y = 0.15
        ax.text(0.06, sig_y,
                'Командир Добровольной Народной Дружины:',
                fontsize=13, color=self._BODY_TEXT, fontweight='bold',
                ha='left', va='top', transform=ax.transAxes)
        ax.text(0.06, sig_y - 0.03, report.commander,
                fontsize=13, color=self._BODY_TEXT, ha='left', va='top',
                transform=ax.transAxes)

        # Save PDF without cropping to preserve A4 dimensions
        fig.savefig(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate a PDF report for the volunteer militia.')
    parser.add_argument('-i', '--input', required=True, help='Path to input JSON with report data.')
    parser.add_argument('-o', '--output', default='report.pdf', help='Output PDF path (default: report.pdf).')
    parser.add_argument('-l', '--logo', required=True, help='Path to the logo PNG with transparent background.')
    args = parser.parse_args()

    # Load data
    report_data = ReportGenerator.load_data(args.input)
    generator = ReportGenerator(args.logo)
    generator.generate(report_data, args.output)
    print(f'Report has been saved to {args.output}')


if __name__ == '__main__':
    main()