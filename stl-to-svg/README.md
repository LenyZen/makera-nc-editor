# STL to SVG

A local page that turns an STL into a closed SVG cutting drawing, in millimetres, for Makera Studio.

**This is not a Makera product.** It is an independent project. Makera did not make it, does not endorse it, and does not support it. A file it writes can be wrong. Check the drawing, and check the size after you import it, before you cut. The author takes no responsibility for issues that arise from using this page. Use at your own risk.

## Install

Nothing to install. The scripts in this folder are the whole program. There is no library, no Python, and no internet step. Dotted names on the page explain each control. Paper, Dark, Warm summer, and Cool autumn are the screen colours, shared with the gear page.

## Open it

Double-click `stl-to-svg.html` in the folder with the NC editor and the gear page. It opens in your browser from the disk. Leave the `stl-to-svg` folder beside that file. The page reads its script and style from there.

## Cut a 1.25 mm ornament

1. Press **Load STL**, or press **Sample ornament**.
2. Press **Top** so the red slice lies in the sheet. Drag the solid to look around. **Use this view** locks the slice to the direction you are looking.
3. Leave the slice in the middle of the 1.25 mm thickness. A through hole stays. A recess that does not go through the sheet disappears. Move the slice near a face and generate again if you need to see which openings are only decorative.
4. Set **Gap repair** to 0.05 mm for intricate work. The page asks before it joins anything.
5. Press **Generate cutting pattern**. Pale is acrylic that stays. Warm gray is cut away. Amber is a piece that will come loose once the cut around it is made. A dashed red line is an open contour.
6. Press **Export SVG**. Every path in the file is closed. The width and height are millimetres, and 1 unit is 1 mm. In Makera Studio, confirm the imported width matches the size on this page before you cut.

The path is the centre of the cut. The file does not offset for a bit, and it does not write an NC file.
