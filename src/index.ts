#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import opentype from "opentype.js";
import meow from "meow";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PATH_PRECISION = 2;

/**
 * Default sources directory path
 */
const DEFAULT_SOURCES_DIR = path.join(__dirname, "../sources");

/**
 * Detects available versions based on folders in the sources directory
 * @param {string} sourcesDir - Path to the sources directory
 * @throws {Error} If no version is detected
 */
function detectAvailableVersions(sourcesDir: string): string[] {
  try {
    const items = fs.readdirSync(sourcesDir, { withFileTypes: true });

    const versions = items
      .filter((item) => item.isDirectory() && !item.name.startsWith("."))
      .map((item) => item.name)
      // Sort versions in descending order (to have the most recent first)
      .sort((a, b) => {
        // Semantic version comparison (e.g., "6.1" > "6.0")
        const partsA = a.split(".").map(Number);
        const partsB = b.split(".").map(Number);

        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
          const partA = partsA[i] || 0;
          const partB = partsB[i] || 0;
          if (partA !== partB) {
            return partB - partA; // Descending order
          }
        }

        return 0;
      });

    if (versions.length === 0) {
      throw new Error(
        `No SF Symbols version detected in the sources directory. Please add at least one version folder containing symbols.txt and names.txt files.`,
      );
    }

    return versions;
  } catch (error) {
    if (error instanceof Error) {
      throw error; // Propagate the error if it's already an Error instance
    } else {
      throw new Error(`Error detecting versions: ${error}`);
    }
  }
}

/**
 * Get available versions from the default sources directory
 * This is used only for CLI default values
 */
function getDefaultVersions(): string[] {
  try {
    return detectAvailableVersions(DEFAULT_SOURCES_DIR);
  } catch (error) {
    // Return empty array if no versions are detected in the default directory
    return [];
  }
}

/**
 * Available SF Symbols versions from default sources (automatically detected)
 */
const AVAILABLE_VERSIONS = getDefaultVersions();

/**
 * Default version (the most recent one, or empty string if no versions are available)
 */
const DEFAULT_VERSION =
  AVAILABLE_VERSIONS.length > 0 ? AVAILABLE_VERSIONS[0] : "";

/**
 * Builds paths to data files for a specific version
 * @param {string} version - SF Symbols version
 * @param {string} sourcesDir - Path to the sources directory
 */
function getVersionPaths(
  version: string,
  sourcesDir: string,
): {
  symbols: string;
  names: string;
} {
  return {
    symbols: path.join(sourcesDir, `${version}/symbols.txt`),
    names: path.join(sourcesDir, `${version}/names.txt`),
  };
}

/**
 * Builds file paths based on the output directory, version, and sources directory
 */
function buildPaths(
  outputDir: string,
  version: string,
  sourcesDir: string,
): {
  SYMBOLS: string;
  NAMES: string;
  SVG_OUTPUT: string;
} {
  const versionPaths = getVersionPaths(version, sourcesDir);

  return {
    SYMBOLS: versionPaths.symbols,
    NAMES: versionPaths.names,
    SVG_OUTPUT: outputDir,
  };
}

/**
 * Checks if data files exist for a specific version
 */
function checkDataFilesExist(version: string, sourcesDir: string): boolean {
  const paths = getVersionPaths(version, sourcesDir);

  if (!fileExists(paths.symbols)) {
    console.error(`symbols.txt file not found: ${paths.symbols}`);
    return false;
  }

  if (!fileExists(paths.names)) {
    console.error(`names.txt file not found: ${paths.names}`);
    return false;
  }

  return true;
}

/**
 * Writes a file to the filesystem, creating directories if needed
 */
function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/**
 * Type for SVG generation options
 */
type GenerateSymbolOptions = {
  fontSize: number;
  padding: number;
};

/**
 * Generates an SVG from a font character
 */
function generateSymbolSvg(
  font: opentype.Font,
  char: string,
  name: string,
  options: GenerateSymbolOptions,
): string | null {
  try {
    const { fontSize, padding } = options;

    const glyphIndex = font.charToGlyphIndex(char);
    if (glyphIndex === 0) return null;

    const glyph = font.glyphs.get(glyphIndex);
    if (!glyph) return null;

    const path = font.getPath(char, 0, 0, fontSize);
    if (!path) return null;

    const bbox = path.getBoundingBox();
    if (!bbox) return null;

    const symbolWidth = bbox.x2 - bbox.x1;
    const symbolHeight = bbox.y2 - bbox.y1;

    const availableWidth = fontSize - padding * 2;
    const availableHeight = fontSize - padding * 2;

    // Calculate the scale needed for the symbol to fit in the available area
    // taking into account padding on all sides
    let scale: number;
    if (symbolWidth / availableWidth > symbolHeight / availableHeight) {
      scale = availableWidth / symbolWidth;
    } else {
      scale = availableHeight / symbolHeight;
    }

    const scaledWidth = symbolWidth * scale;
    const scaledHeight = symbolHeight * scale;

    // Calculate translations needed to center the symbol in the viewBox
    const translateX = (fontSize - scaledWidth) / 2 - bbox.x1 * scale;
    const translateY = (fontSize - scaledHeight) / 2 - bbox.y1 * scale;
    const transformMatrix = [scale, 0, 0, scale, translateX, translateY];
    const pathElement = path.toSVG(PATH_PRECISION);

    const dMatch = pathElement.match(/d="([^"]*)"/i);

    if (!dMatch) return null;

    const dContent = dMatch[1];

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fontSize} ${fontSize}" width="${fontSize}" height="${fontSize}">
  <title>${name}</title>
  <path transform="matrix(${transformMatrix.join(", ")})" d="${dContent}" fill="currentColor"/>
</svg>`;
  } catch (error) {
    console.error(`Error generating SVG for ${name}:`, error);
    return null;
  }
}

/**
 * Creates a safe filename from a symbol name
 */
function createSafeFilename(name: string): string {
  return name.replace(/[^a-z0-9\.]/gi, "_").toLowerCase();
}

/**
 * Creates a filename for an SVG with appropriate weight suffix
 */
function createSvgFilename(name: string, weight: string): string {
  const safeName = createSafeFilename(name);
  if (weight === "regular") {
    return `${safeName}.svg`;
  }
  return `${safeName}-${weight}.svg`;
}

/**
 * Type for SVG generation options
 */
type MakeSvgsOptions = {
  /**
   * Font size for symbols
   * @default 24
   */
  fontSize?: number;

  /**
   * Padding in pixels
   * @default 2
   */
  padding?: number;

  /**
   * Font weights to include
   * @default ["regular"]
   */
  weights?: string[];

  /**
   * Output directory for SVGs and JSONs
   * @default process.cwd() + "/sf-symbols-svgs"
   */
  outputDir?: string;

  /**
   * Directory containing SF Pro Text fonts
   * @default "/Library/Fonts"
   */
  fontsDir?: string;

  /**
   * SF Symbols version to use
   * @default The latest available version
   */
  version?: string;

  /**
   * Directory containing SF Symbols data files (symbols.txt and names.txt)
   * @default "./sources"
   */
  sourcesDir?: string;

  /**
   * Path to a file containing a list of icons to process (one per line)
   * If provided, only these icons will be processed
   * @default undefined
   */
  iconsListFile?: string;
};

/**
 * Checks if a file exists
 */
function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the font file in the fonts directory
 */
function findFontFile(fontsDir: string, weight: string): string | null {
  // Expected format for SF Pro Text
  const fontName = `SF-Pro-Text-${weight.charAt(0).toUpperCase() + weight.slice(1)}.otf`;
  const fontPath = path.join(fontsDir, fontName);

  // Check if the file exists
  if (fileExists(fontPath)) {
    return fontPath;
  }

  return null;
}

/**
 * Main function to generate SVG files directly from font files
 */
async function makeSvgs(options?: MakeSvgsOptions): Promise<void> {
  const {
    fontSize = 24,
    padding = 2,
    weights = ["regular"],
    outputDir: outputDirOption = path.join(process.cwd(), "sf-symbols-svgs"),
    fontsDir: fontsDirOption = "/Library/Fonts",
    version: versionOption = DEFAULT_VERSION,
    sourcesDir: sourcesDirOption = DEFAULT_SOURCES_DIR,
    iconsListFile: iconsListFileOption,
  } = options || {};

  const fontsDir = String(fontsDirOption);
  const outputDir = String(outputDirOption);
  const sourcesDir = String(sourcesDirOption);

  let availableVersions: string[];
  try {
    availableVersions = detectAvailableVersions(sourcesDir);
  } catch (error) {
    throw new Error(
      `No SF Symbols versions detected in ${sourcesDir}. Please provide a valid sources directory containing version folders with symbols.txt and names.txt files.`,
    );
  }

  const version = versionOption ? String(versionOption) : availableVersions[0];

  if (!fontsDir) {
    throw new Error(
      "fonts-dir option is required. Please specify the directory containing SF Pro Text fonts.",
    );
  }

  try {
    const versionStr = String(version);
    const sourcesStr = String(sourcesDir);
    const sourcesVersionDir = path.join(sourcesStr, versionStr);
    const stats = fs.statSync(sourcesVersionDir);
    if (!stats.isDirectory()) {
      throw new Error(`${sourcesVersionDir} is not a directory`);
    }
  } catch (error) {
    throw new Error(
      `SF Symbols version '${version}' not found in ${sourcesDir}. Please make sure the directory exists and contains the required data files.`,
    );
  }

  if (!checkDataFilesExist(String(version), sourcesDir)) {
    throw new Error(
      `Data files for SF Symbols ${version} are missing in ${sourcesDir}/${version}/. Please check the README for setup instructions.`,
    );
  }

  const PATHS = buildPaths(outputDir, String(version), sourcesDir);

  console.log("Loading Fonts...");
  const fonts = await Promise.all(
    weights.map(async (weight) => {
      try {
        const fontPath = findFontFile(fontsDir, weight);

        if (!fontPath) {
          console.error(
            `Font file for weight '${weight}' not found in ${fontsDir}`,
          );
          console.error(
            `Please make sure SF-Pro-Text-${weight.charAt(0).toUpperCase() + weight.slice(1)}.otf is installed in the specified fonts directory.`,
          );
          return null;
        }

        console.log(`Loading font: ${fontPath}`);
        const font = await opentype.load(fontPath);
        return { weight, font };
      } catch (error) {
        console.error(`Error loading font weight ${weight}:`, error);
        return null;
      }
    }),
  );

  type ValidFont = { weight: string; font: opentype.Font };

  const validFonts: ValidFont[] = fonts.filter(
    (item): item is ValidFont => !!item,
  );

  if (validFonts.length === 0) {
    throw new Error(
      "No valid fonts were loaded. Please check the weights and font files.",
    );
  }

  console.log(`Fonts loaded: ${validFonts.map((f) => f.weight).join(", ")}`);
  console.log("Capturing Paths... This takes a while");

  let symbolsData =
    fs
      .readFileSync(PATHS.SYMBOLS, { encoding: "utf-8" })
      .match(/.{1,2}/g)
      ?.filter((char: string) => char !== "") || [];

  let names = fs
    .readFileSync(PATHS.NAMES, { encoding: "utf8", flag: "r" })
    .split(/\r?\n/)
    .filter((char: string) => char !== "");

  if (iconsListFileOption) {
    try {
      const iconsList = fs
        .readFileSync(String(iconsListFileOption), {
          encoding: "utf8",
          flag: "r",
        })
        .split(/\r?\n/)
        .filter((name: string) => name !== "");

      if (iconsList.length === 0) {
        console.warn(
          `Icons list file ${iconsListFileOption} is empty. Using all available icons.`,
        );
      } else {
        const filteredNamesIndices: number[] = [];
        const filteredNames: string[] = [];
        const filteredSymbols: string[] = [];

        for (const iconName of iconsList) {
          const index = names.indexOf(iconName);
          if (index !== -1) {
            filteredNamesIndices.push(index);
            filteredNames.push(iconName);
            if (index < symbolsData.length) {
              const charItem = symbolsData[index];
              if (charItem) {
                filteredSymbols.push(charItem);
              }
            }
          } else {
            console.warn(`Icon '${iconName}' not found in available icons.`);
          }
        }

        if (filteredNames.length === 0) {
          console.warn(
            "None of the specified icons were found. Using all available icons.",
          );
        } else {
          console.log(
            `Processing ${filteredNames.length} icons from list file.`,
          );
          names = filteredNames;
          symbolsData = filteredSymbols;
        }
      }
    } catch (error) {
      console.error(`Error reading icons list file: ${error}`);
      console.warn("Using all available icons.");
    }
  }

  console.log(`Output directory: ${outputDir}`);
  fs.mkdirSync(PATHS.SVG_OUTPUT, { recursive: true });

  for (let namesIndex = 0; namesIndex < names.length; namesIndex++) {
    const name = names[namesIndex];
    if (!name) continue;
    console.log(`${namesIndex + 1}/${names.length} - ${name}`);

    const char = symbolsData[namesIndex];
    if (!char) continue;

    for (const { weight, font } of validFonts) {
      const svgContent = generateSymbolSvg(font, char, name, {
        fontSize,
        padding,
      });
      if (!svgContent) continue;

      const svgFilename = createSvgFilename(name, weight);

      const svgPath = path.join(PATHS.SVG_OUTPUT, svgFilename);
      writeFile(svgPath, svgContent);
    }
  }

  console.log("Done! Generated SVG files in", PATHS.SVG_OUTPUT);
}

const cli = meow(
  `
  Usage
    $ sf-symbols-svg [options]

  Options
    --size, -s       Font size for symbols (default: 24)
    --padding, -p    Padding in pixels (default: 2)
    --weight, -w     Font weights to include (default: regular)
                     Can specify multiple: -w regular -w bold
                     Special value "all" to include all available weights
    --output, -o     Output directory (default: ./sf-symbols-svgs)
    --fonts-dir, -f  Directory containing SF Pro Text fonts (default: /Library/Fonts)
    --sf-version     SF Symbols version to use (default: latest)
    --sources-dir    Directory containing SF Symbols data files (default: ./sources)
    --icons-list     Path to a file containing a list of icons to process, one name per line (optional)
    --help, -h       Show this help message
    --version        Show version

  Examples
    $ sf-symbols-svg
    $ sf-symbols-svg --size 32 --padding 4
    $ sf-symbols-svg --weight bold --weight black
    $ sf-symbols-svg --weight all
    $ sf-symbols-svg --output ./my-icons
    $ sf-symbols-svg --fonts-dir ~/Library/Fonts
    $ sf-symbols-svg --sf-version 6.0
`,

  {
    importMeta: import.meta,
    flags: {
      size: {
        type: "number",
        default: 24,
        shortFlag: "s",
      },
      padding: {
        type: "number",
        default: 2,
        shortFlag: "p",
      },
      weight: {
        type: "string",
        default: ["regular"],
        isMultiple: true,
        shortFlag: "w",
      },
      output: {
        type: "string",
        shortFlag: "o",
      },
      fontsDir: {
        type: "string",
        shortFlag: "f",
      },
      sfVersion: {
        type: "string",
      },
      sourcesDir: {
        type: "string",
        description: "Directory containing SF Symbols data files",
      },
      iconsList: {
        type: "string",
        description:
          "Path to a file containing a list of icons to process (one per line)",
      },
      help: {
        type: "boolean",
        shortFlag: "h",
      },
    },
  },
);

/**
 * Available font weights
 */
const FONT_WEIGHTS = [
  "thin",
  "ultraLight",
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
  "heavy",
  "black",
];

// Process weights option - handle "all" special value
let weights = cli.flags.weight;
if (weights.length === 1 && weights[0].toLowerCase() === "all") {
  weights = FONT_WEIGHTS;
  console.log(`Using all available weights: ${weights.join(", ")}`);
}

makeSvgs({
  fontSize: cli.flags.size,
  padding: cli.flags.padding,
  weights: weights,
  outputDir: cli.flags.output,
  fontsDir: cli.flags.fontsDir,
  version: cli.flags.sfVersion,
  sourcesDir: cli.flags.sourcesDir,
  iconsListFile: cli.flags.iconsList,
}).catch((error: Error) => {
  console.error("Error generating SVGs:", error);
  process.exit(1);
});
