#!/usr/bin/env python3
"""
Console utility to generate a monthly report PDF for the volunteer militia.

This script reads two JSON files: one containing constant fields (organisation
name, municipality, team name, commander and small header lines) and another
containing variable data for a specific month (month name, year and a list
of activities).  It then produces a professionally formatted A4 PDF
according to a fixed layout.  All font sizes, margins and line spacing
are constant across pages to ensure visual consistency.

Usage:

    python generate_report.py --input data.json --constants constants.json \
        --logo emblem.png --output report.pdf

You can optionally provide a configuration JSON via ``--config`` to
override layout parameters such as margins and colours.
"""

import argparse
import json
import textwrap
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import matplotlib

matplotlib.use('Agg')  # ensure non‑interactive backend
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from PIL import Image


# === Constants for text formatting ===
class TextFormatting:
    """Constants for text formatting throughout the report."""
    SMALL_HEADER_WRAP_WIDTH = 60
    ACTIVITY_TEXT_WRAP_WIDTH = 80
    ACTIVITY_NUMBERING_FORMAT = "{idx}. "
    SUBITEM_NUMBERING_FORMAT = "{idx}) "
    FIRST_PAGE_NUMBER = 1
    MIN_LINES_PER_PAGE = 1
    ORGANIZATION_NAME_SPLIT_LIMIT = 1


# === Constants for page layout ===
class PageDimensions:
    """A4 page dimensions in inches."""
    WIDTH_INCHES = 8.27
    HEIGHT_INCHES = 11.69


class CoordinateSystem:
    """Constants for matplotlib coordinate system."""
    PAGE_TOP = 1.0
    PAGE_BOTTOM = 0.0
    PAGE_LEFT = 0.0
    PAGE_RIGHT = 1.0
    FULL_WIDTH = 1.0


class ZOrder:
    """Z-order constants for layering elements."""
    HEADER_BACKGROUND = 0
    LOGO_PANEL = 1
    LOGO_IMAGE = 2


# === Constants for font sizes ===
class FontSizes:
    """Font sizes used throughout the report."""
    SMALL_HEADER_TEXT = 7.5
    ORGANIZATION_TITLE = 34
    STATION_TEAM_TEXT = 13
    REPORT_TITLE = 24
    SECTION_HEADING = 18
    ACTIVITY_LIST = 11
    SIGNATURE = 13


# === Constants for text alignment ===
class TextAlignment:
    """Text alignment constants."""
    LEFT = 'left'
    TOP = 'top'
    BOLD = 'bold'


# === Constants for text labels ===
class TextLabels:
    """Russian text labels used in the report."""
    REPORT_TITLE_TEMPLATE = 'Отчёт за {month} {year}'
    SECTION_HEADING_TEMPLATE = 'За {month} {year} проведено:'
    SIGNATURE_TITLE = 'Командир Добровольной Народной Дружины:'


# === Constants for image processing ===
class ImageProcessing:
    """Constants for logo image processing."""
    RGBA_MODE = 'RGBA'
    TRANSPARENT_COLOR = (0, 0, 0, 0)
    ALPHA_CHANNEL_INDEX = -1


# === Constants for activity list indentation ===
class IndentationLevel:
    """Indentation levels for activities."""
    MAIN_ACTIVITY = 0
    SUB_ITEM = 1


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

    # Spacing around major sections of the report.  These constants are
    # expressed as fractions of the page height and can be overridden via
    # the optional configuration file.  Adjusting them allows you to
    # fine‑tune the distances between header, title, subheading, the
    # activities list and the signature.
    body_gap: float = 0.02  # vertical space between the header and the report title
    subheading_gap: float = 0.06  # vertical space between the title and the red subheading
    list_gap: float = 0.08  # vertical space between the subheading and the start of the list
    signature_min_height: float = 0.07  # minimum space required to draw the signature block
    signature_offset: float = 0.05  # offset from the last list line to the first signature line
    signature_line_gap: float = 0.03  # gap between the two lines of the signature

    # Compensation factor applied to the logo's height when computing its
    # aspect ratio.  Values less than 1.0 will effectively reduce the
    # perceived height of the logo, making it wider.  Use this if your
    # logo appears too narrow.  Default is 1.0 (no compensation).
    logo_height_compensation: float = 1.0

    # Horizontal margin for text and logo positions (fraction of page width).
    # This value determines how far from the left edge the text begins and
    # how far from the right edge the logo ends.  Adjust via config if
    # your report needs wider margins.
    content_margin: float = 0.06

    # Additional horizontal indent for subitems in the activity list.  This
    # value is added to ``content_margin`` for each level of indentation.
    sub_indent: float = 0.02

    # Background colour for the area behind the logo on the first page.  Use
    # this to visually separate the logo from the rest of the header.  You
    # can override this in a configuration file.  The default is a dark
    # teal that contrasts with the main header colour.
    logo_bg_colour: str = '#008080'

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


@dataclass
class HeaderGeometry:
    """Encapsulates header positioning information."""
    top: float
    bottom: float
    height: float


@dataclass
class PageLayout:
    """Encapsulates the calculated layout for a page."""
    header: HeaderGeometry
    body_start_y: float
    available_height: float


class LogoProcessor:
    """Handles logo image loading and preprocessing."""

    @staticmethod
    def load_and_prepare(logo_path: str) -> Image.Image:
        """
        Load logo image, crop transparent borders, and ensure square dimensions.

        Args:
            logo_path: Path to the logo image file.

        Returns:
            Prepared logo image with square dimensions.
        """
        img = Image.open(logo_path).convert(ImageProcessing.RGBA_MODE)
        img = LogoProcessor._crop_transparent_border(img)
        img = LogoProcessor._ensure_square(img)
        return img

    @staticmethod
    def _crop_transparent_border(img: Image.Image) -> Image.Image:
        """Crop transparent borders from the image."""
        alpha = img.split()[ImageProcessing.ALPHA_CHANNEL_INDEX]
        bbox = alpha.getbbox()
        if bbox:
            img = img.crop(bbox)
        return img

    @staticmethod
    def _ensure_square(img: Image.Image) -> Image.Image:
        """Ensure the image has square dimensions by padding if necessary."""
        width, height = img.size
        if width != height:
            side = max(width, height)
            square_img = Image.new(
                ImageProcessing.RGBA_MODE,
                (side, side),
                ImageProcessing.TRANSPARENT_COLOR
            )
            offset_x = (side - width) // 2
            offset_y = (side - height) // 2
            square_img.paste(img, (offset_x, offset_y))
            return square_img
        return img


class ActivityFlattener:
    """Converts hierarchical activities into flat list of formatted lines."""

    def __init__(self, wrap_width: int = TextFormatting.ACTIVITY_TEXT_WRAP_WIDTH):
        """
        Initialize the flattener.

        Args:
            wrap_width: Character width for text wrapping.
        """
        self.wrapper = textwrap.TextWrapper(width=wrap_width)

    def flatten(self, activities: List[Activity]) -> List[Tuple[int, str]]:
        """
        Flatten activities into a list of (indent_level, formatted_text) tuples.

        Args:
            activities: List of Activity objects.

        Returns:
            List of tuples containing indent level and formatted text.
        """
        flat_lines: List[Tuple[int, str]] = []

        for idx, activity in enumerate(activities, start=TextFormatting.FIRST_PAGE_NUMBER):
            flat_lines.extend(self._format_main_activity(activity, idx))
            flat_lines.extend(self._format_subitems(activity.subitems))

        return flat_lines

    def _format_main_activity(self, activity: Activity, index: int) -> List[Tuple[int, str]]:
        """Format a main activity with numbering."""
        lines = self.wrapper.wrap(activity.text)
        if lines:
            lines[0] = TextFormatting.ACTIVITY_NUMBERING_FORMAT.format(idx=index) + lines[0]
        return [(IndentationLevel.MAIN_ACTIVITY, line) for line in lines]

    def _format_subitems(self, subitems: List[str]) -> List[Tuple[int, str]]:
        """Format subitems with numbering and indentation."""
        flat_subitems: List[Tuple[int, str]] = []

        for sub_idx, subitem in enumerate(subitems or [], start=TextFormatting.FIRST_PAGE_NUMBER):
            sub_lines = self.wrapper.wrap(subitem)
            if sub_lines:
                sub_lines[0] = TextFormatting.SUBITEM_NUMBERING_FORMAT.format(idx=sub_idx) + sub_lines[0]
            flat_subitems.extend([(IndentationLevel.SUB_ITEM, line) for line in sub_lines])

        return flat_subitems


class LayoutCalculator:
    """Calculates page layout dimensions."""

    def __init__(self, config: ReportConfig):
        """
        Initialize calculator with configuration.

        Args:
            config: Report configuration object.
        """
        self.config = config

    def calculate_header_geometry(self, is_first_page: bool) -> HeaderGeometry:
        """
        Calculate header positioning for a page.

        Args:
            is_first_page: Whether this is the first page.

        Returns:
            HeaderGeometry object with calculated positions.
        """
        cfg = self.config
        header_top = CoordinateSystem.PAGE_TOP - cfg.top_margin

        if is_first_page:
            header_height = cfg.header_height
        else:
            header_height = cfg.header_height * cfg.small_header_factor

        header_bottom = header_top - header_height

        return HeaderGeometry(
            top=header_top,
            bottom=header_bottom,
            height=header_height
        )

    def calculate_first_page_layout(self) -> PageLayout:
        """Calculate layout dimensions for the first page."""
        cfg = self.config
        header = self.calculate_header_geometry(is_first_page=True)

        body_top = header.bottom - cfg.body_gap
        subheading_y = body_top - cfg.subheading_gap
        list_start_y = subheading_y - cfg.list_gap
        available_height = list_start_y - cfg.bottom_margin

        return PageLayout(
            header=header,
            body_start_y=list_start_y,
            available_height=available_height
        )

    def calculate_subsequent_page_layout(self) -> PageLayout:
        """Calculate layout dimensions for subsequent pages."""
        cfg = self.config
        header = self.calculate_header_geometry(is_first_page=False)

        body_start_y = header.bottom - cfg.body_gap
        available_height = body_start_y - cfg.bottom_margin

        return PageLayout(
            header=header,
            body_start_y=body_start_y,
            available_height=available_height
        )

    def calculate_lines_per_page(self) -> int:
        """
        Calculate how many activity lines fit on a page.

        Uses the minimum available height across first and subsequent pages
        to ensure consistent line density.

        Returns:
            Number of lines that fit on a page.
        """
        first_page = self.calculate_first_page_layout()
        subsequent_page = self.calculate_subsequent_page_layout()

        min_available = min(first_page.available_height, subsequent_page.available_height)
        lines_per_page = max(
            int(min_available // self.config.line_height),
            TextFormatting.MIN_LINES_PER_PAGE
        )

        return lines_per_page


class HeaderRenderer:
    """Renders header elements on a page."""

    def __init__(self, config: ReportConfig):
        """
        Initialize renderer with configuration.

        Args:
            config: Report configuration object.
        """
        self.config = config

    def render_background(self, ax, header: HeaderGeometry) -> None:
        """
        Render the colored background bar for the header.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
        """
        ax.add_patch(
            plt.Rectangle(
                (CoordinateSystem.PAGE_LEFT, header.bottom),
                CoordinateSystem.FULL_WIDTH,
                header.height,
                color=self.config.colours['green_dark'],
                transform=ax.transAxes,
                zorder=ZOrder.HEADER_BACKGROUND
            )
        )

    def render_small_lines(self, ax, header: HeaderGeometry, small_lines: List[str]) -> None:
        """
        Render small header lines at the top of the header bar.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
            small_lines: List of wrapped small header lines.
        """
        if not small_lines:
            return

        cfg = self.config
        num_lines = len(small_lines)

        if num_lines > 0:
            spacing_fraction = cfg.small_lines_reserved / num_lines

            for i, line in enumerate(small_lines):
                y_position = header.top - (cfg.small_lines_start + i * spacing_fraction) * header.height
                ax.text(
                    cfg.content_margin,
                    y_position,
                    line,
                    fontsize=FontSizes.SMALL_HEADER_TEXT,
                    color=cfg.colours['small_text'],
                    ha=TextAlignment.LEFT,
                    va=TextAlignment.TOP,
                    transform=ax.transAxes
                )

    def render_organization_name(self, ax, header: HeaderGeometry, organization: str) -> None:
        """
        Render the organization name in the header.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
            organization: Organization name text.
        """
        cfg = self.config
        org_y = header.top - cfg.org_line1_offset * header.height

        ax.text(
            cfg.content_margin,
            org_y,
            organization,
            fontsize=FontSizes.ORGANIZATION_TITLE,
            color=cfg.colours['accent_yellow'],
            fontweight=TextAlignment.BOLD,
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )


class FirstPageRenderer:
    """Renders elements specific to the first page."""

    def __init__(self, config: ReportConfig, logo: Image.Image):
        """
        Initialize renderer.

        Args:
            config: Report configuration object.
            logo: Prepared logo image.
        """
        self.config = config
        self.logo = logo

    def render_station_and_team(self, ax, header: HeaderGeometry, report: ReportData) -> None:
        """
        Render station and team name lines.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
            report: Report data.
        """
        cfg = self.config
        station_y = header.bottom + cfg.station_line_offset * header.height
        team_y = header.bottom + cfg.team_line_offset * header.height

        ax.text(
            cfg.content_margin,
            station_y,
            report.station,
            fontsize=FontSizes.STATION_TEAM_TEXT,
            color=cfg.colours['header_text'],
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )

        ax.text(
            cfg.content_margin,
            team_y,
            report.team_name,
            fontsize=FontSizes.STATION_TEAM_TEXT,
            color=cfg.colours['header_text'],
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )

    def render_logo(self, ax, header: HeaderGeometry) -> None:
        """
        Render the logo with its background panel.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
        """
        cfg = self.config

        # Calculate logo dimensions
        raw_aspect = self.logo.width / self.logo.height
        adjusted_aspect = (
            raw_aspect / cfg.logo_height_compensation
            if cfg.logo_height_compensation
            else raw_aspect
        )

        logo_width = cfg.logo_width_fraction
        logo_height = logo_width / adjusted_aspect
        logo_x = CoordinateSystem.PAGE_RIGHT - cfg.content_margin - logo_width
        logo_y = header.bottom + (header.height - logo_height) / 2

        # Draw background panel
        panel_width = CoordinateSystem.PAGE_RIGHT - logo_x
        ax.add_patch(
            plt.Rectangle(
                (logo_x, header.bottom),
                panel_width,
                header.height,
                color=cfg.logo_bg_colour,
                transform=ax.transAxes,
                zorder=ZOrder.LOGO_PANEL
            )
        )

        # Draw logo
        ax.imshow(
            self.logo,
            extent=(logo_x, logo_x + logo_width, logo_y, logo_y + logo_height),
            transform=ax.transAxes,
            zorder=ZOrder.LOGO_IMAGE
        )

    def render_titles(self, ax, header: HeaderGeometry, report: ReportData) -> float:
        """
        Render report title and section heading.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
            report: Report data.

        Returns:
            Y-coordinate where the activity list should start.
        """
        cfg = self.config

        body_top = header.bottom - cfg.body_gap
        title_y = body_top
        subheading_y = body_top - cfg.subheading_gap

        # Main title
        title_text = TextLabels.REPORT_TITLE_TEMPLATE.format(
            month=report.month,
            year=report.year
        )
        ax.text(
            cfg.content_margin,
            title_y,
            title_text,
            fontsize=FontSizes.REPORT_TITLE,
            color=cfg.colours['subheader_green'],
            fontweight=TextAlignment.BOLD,
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )

        # Section heading
        heading_text = TextLabels.SECTION_HEADING_TEMPLATE.format(
            month=report.month,
            year=report.year
        )
        ax.text(
            cfg.content_margin,
            subheading_y,
            heading_text,
            fontsize=FontSizes.SECTION_HEADING,
            color=cfg.colours['red'],
            fontweight=TextAlignment.BOLD,
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )

        return subheading_y - cfg.list_gap


class ActivityListRenderer:
    """Renders the activity list on a page."""

    def __init__(self, config: ReportConfig):
        """
        Initialize renderer.

        Args:
            config: Report configuration object.
        """
        self.config = config

    def render_lines(
            self,
            ax,
            flat_lines: List[Tuple[int, str]],
            start_index: int,
            num_lines: int,
            start_y: float
    ) -> float:
        """
        Render a portion of the activity list.

        Args:
            ax: Matplotlib axes object.
            flat_lines: Flattened list of activities.
            start_index: Index to start rendering from.
            num_lines: Number of lines to render.
            start_y: Y-coordinate to start rendering.

        Returns:
            Y-coordinate after the last rendered line.
        """
        cfg = self.config
        current_y = start_y

        for i in range(num_lines):
            indent_level, text = flat_lines[start_index + i]
            x_position = cfg.content_margin + cfg.sub_indent * indent_level

            ax.text(
                x_position,
                current_y,
                text,
                fontsize=FontSizes.ACTIVITY_LIST,
                color=cfg.colours['body_text'],
                ha=TextAlignment.LEFT,
                va=TextAlignment.TOP,
                transform=ax.transAxes
            )

            current_y -= cfg.line_height

        return current_y


class SignatureRenderer:
    """Renders the signature block."""

    def __init__(self, config: ReportConfig):
        """
        Initialize renderer.

        Args:
            config: Report configuration object.
        """
        self.config = config

    def render(self, ax, y_position: float, commander_name: str) -> None:
        """
        Render the signature block at the specified position.

        Args:
            ax: Matplotlib axes object.
            y_position: Y-coordinate for the signature.
            commander_name: Name of the commander.
        """
        cfg = self.config

        ax.text(
            cfg.content_margin,
            y_position,
            TextLabels.SIGNATURE_TITLE,
            fontsize=FontSizes.SIGNATURE,
            color=cfg.colours['body_text'],
            fontweight=TextAlignment.BOLD,
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )

        ax.text(
            cfg.content_margin,
            y_position - cfg.signature_line_gap,
            commander_name,
            fontsize=FontSizes.SIGNATURE,
            color=cfg.colours['body_text'],
            ha=TextAlignment.LEFT,
            va=TextAlignment.TOP,
            transform=ax.transAxes
        )

    def can_fit_on_page(self, current_y: float) -> bool:
        """
        Check if signature block can fit at the given Y position.

        Args:
            current_y: Current Y-coordinate.

        Returns:
            True if signature fits, False otherwise.
        """
        required_height = self.config.signature_min_height
        return (current_y - required_height) > self.config.bottom_margin

    def calculate_signature_position(self, list_end_y: float) -> float:
        """
        Calculate appropriate Y position for signature.

        Args:
            list_end_y: Y-coordinate where the list ended.

        Returns:
            Y-coordinate for signature placement.
        """
        cfg = self.config
        sig_y = list_end_y - cfg.signature_offset
        minimum_y = cfg.bottom_margin + cfg.signature_offset

        return max(sig_y, minimum_y)


class PageRenderer:
    """Orchestrates rendering of a complete page."""

    def __init__(
            self,
            config: ReportConfig,
            logo: Image.Image,
            small_lines_wrapped: List[str],
            organization_title: str
    ):
        """
        Initialize page renderer.

        Args:
            config: Report configuration object.
            logo: Prepared logo image.
            small_lines_wrapped: Wrapped small header lines.
            organization_title: Formatted organization title.
        """
        self.config = config
        self.logo = logo
        self.small_lines_wrapped = small_lines_wrapped
        self.organization_title = organization_title

        self.header_renderer = HeaderRenderer(config)
        self.first_page_renderer = FirstPageRenderer(config, logo)
        self.activity_renderer = ActivityListRenderer(config)
        self.signature_renderer = SignatureRenderer(config)

    def create_figure(self):
        """Create a new matplotlib figure for a page."""
        fig = plt.figure(figsize=(PageDimensions.WIDTH_INCHES, PageDimensions.HEIGHT_INCHES))
        ax = fig.add_axes([CoordinateSystem.PAGE_LEFT, CoordinateSystem.PAGE_BOTTOM,
                           CoordinateSystem.FULL_WIDTH, CoordinateSystem.FULL_WIDTH])
        ax.axis('off')
        return fig, ax

    def render_common_header(self, ax, header: HeaderGeometry) -> None:
        """
        Render header elements common to all pages.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
        """
        self.header_renderer.render_background(ax, header)
        self.header_renderer.render_small_lines(ax, header, self.small_lines_wrapped)
        self.header_renderer.render_organization_name(ax, header, self.organization_title)

    def render_first_page_content(self, ax, header: HeaderGeometry, report: ReportData) -> float:
        """
        Render content specific to the first page.

        Args:
            ax: Matplotlib axes object.
            header: Header geometry information.
            report: Report data.

        Returns:
            Y-coordinate where the activity list should start.
        """
        self.first_page_renderer.render_station_and_team(ax, header, report)
        self.first_page_renderer.render_logo(ax, header)
        return self.first_page_renderer.render_titles(ax, header, report)


class ReportGenerator:
    """Generates a PDF report from supplied data and a logo."""

    def __init__(self, logo_path: str, config: Optional[ReportConfig] = None) -> None:
        """
        Initialize the report generator.

        Args:
            logo_path: Path to the logo image file.
            config: Optional report configuration. Uses defaults if not provided.
        """
        self.logo = LogoProcessor.load_and_prepare(logo_path)
        self.config = config or ReportConfig()
        self.layout_calculator = LayoutCalculator(self.config)

    def _prepare_organization_title(self, organization: str) -> str:
        """
        Format organization name for display (split after first space).

        Args:
            organization: Organization name.

        Returns:
            Formatted organization title.
        """
        org = organization.strip()
        if ' ' in org:
            return org.replace(' ', '\n', TextFormatting.ORGANIZATION_NAME_SPLIT_LIMIT)
        return org

    def _wrap_small_lines(self, lines: List[str]) -> List[str]:
        """
        Wrap small header lines to prevent overflow.

        Args:
            lines: List of small header lines.

        Returns:
            List of wrapped lines.
        """
        wrapper = textwrap.TextWrapper(width=TextFormatting.SMALL_HEADER_WRAP_WIDTH)
        wrapped: List[str] = []
        for line in lines:
            wrapped.extend(wrapper.wrap(line))
        return wrapped

    def generate(self, report: ReportData, output_path: str) -> None:
        """
        Generate a multi-page PDF report.

        Args:
            report: Report data to render.
            output_path: Path where the PDF should be saved.
        """
        # Prepare data
        flattener = ActivityFlattener()
        flat_lines = flattener.flatten(report.activities)
        total_lines = len(flat_lines)

        small_lines_wrapped = self._wrap_small_lines(report.small_lines)
        organization_title = self._prepare_organization_title(report.organization)

        # Calculate layout
        lines_per_page = self.layout_calculator.calculate_lines_per_page()

        # Initialize renderers
        page_renderer = PageRenderer(
            self.config,
            self.logo,
            small_lines_wrapped,
            organization_title
        )

        # Generate pages
        current_index = 0
        page_number = 0

        with PdfPages(output_path) as pdf:
            while current_index < total_lines or page_number == 0:
                page_number += 1
                is_first_page = (page_number == TextFormatting.FIRST_PAGE_NUMBER)

                fig, ax = page_renderer.create_figure()

                # Calculate and render header
                header = self.layout_calculator.calculate_header_geometry(is_first_page)
                page_renderer.render_common_header(ax, header)

                # Determine list start position
                if is_first_page:
                    list_start_y = page_renderer.render_first_page_content(ax, header, report)
                else:
                    list_start_y = header.bottom - self.config.body_gap

                # Render activity lines
                lines_remaining = total_lines - current_index
                lines_this_page = min(lines_remaining, lines_per_page)

                list_end_y = page_renderer.activity_renderer.render_lines(
                    ax,
                    flat_lines,
                    current_index,
                    lines_this_page,
                    list_start_y
                )

                current_index += lines_this_page

                # Handle signature on last page
                if current_index >= total_lines:
                    self._render_signature(
                        pdf,
                        page_renderer,
                        list_end_y,
                        report.commander,
                        organization_title,
                        small_lines_wrapped
                    )

                pdf.savefig(fig)
                plt.close(fig)

    def _render_signature(
            self,
            pdf: PdfPages,
            page_renderer: PageRenderer,
            list_end_y: float,
            commander: str,
            organization_title: str,
            small_lines_wrapped: List[str]
    ) -> None:
        """
        Render signature block, creating a new page if necessary.

        Args:
            pdf: PDF pages object.
            page_renderer: Page renderer instance.
            list_end_y: Y-coordinate where the list ended.
            commander: Commander name.
            organization_title: Formatted organization title.
            small_lines_wrapped: Wrapped small header lines.
        """
        signature_renderer = page_renderer.signature_renderer

        if signature_renderer.can_fit_on_page(list_end_y):
            # Signature fits on current page
            sig_y = signature_renderer.calculate_signature_position(list_end_y)

            # Get the current figure's axes
            fig = plt.gcf()
            ax = fig.get_axes()[0]
            signature_renderer.render(ax, sig_y, commander)
        else:
            # Need a new page for signature
            fig, ax = page_renderer.create_figure()

            header = self.layout_calculator.calculate_header_geometry(is_first_page=False)
            page_renderer.render_common_header(ax, header)

            sig_y = header.bottom - self.config.body_gap - self.config.signature_offset
            signature_renderer.render(ax, sig_y, commander)

            pdf.savefig(fig)
            plt.close(fig)


def parse_report_data(data: dict) -> ReportData:
    """
    Build a ReportData instance from a dictionary.

    Args:
        data: Dictionary containing report data.

    Returns:
        ReportData instance.
    """
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


def main() -> None:
    """Main entry point for the report generation script."""
    parser = argparse.ArgumentParser(
        description='Generate a PDF report for the volunteer militia.'
    )
    parser.add_argument(
        '-i', '--input',
        required=True,
        help='Path to JSON file with variable report data.'
    )
    parser.add_argument(
        '-C', '--constants',
        required=False,
        help='Path to JSON file with constant report fields.'
    )
    parser.add_argument(
        '-l', '--logo',
        required=True,
        help='Path to logo PNG with transparent background.'
    )
    parser.add_argument(
        '-o', '--output',
        default='report.pdf',
        help='Path to output PDF file.'
    )
    parser.add_argument(
        '-c', '--config',
        help='Optional path to JSON configuration file.'
    )
    args = parser.parse_args()

    # Load configuration
    cfg = ReportConfig.load(args.config) if args.config else None

    # Load constants if provided
    consts = {}
    if args.constants:
        with open(args.constants, 'r', encoding='utf-8') as f:
            consts = json.load(f)

    # Load variable data
    with open(args.input, 'r', encoding='utf-8') as f:
        var_data = json.load(f)

    # Merge constants into variable data if keys are missing
    for key, value in consts.items():
        var_data.setdefault(key, value)

    # Parse and generate
    report_data = parse_report_data(var_data)
    generator = ReportGenerator(args.logo, config=cfg)
    generator.generate(report_data, args.output)

    print(f'Report saved to {args.output}')


if __name__ == '__main__':
    main()
