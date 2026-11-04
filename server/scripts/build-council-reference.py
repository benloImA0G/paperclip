#!/usr/bin/env python3
"""Build the council export reference files from Pandoc's stock templates."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from subprocess import run
import re

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "src/services"
TMP = ROOT / ".council-reference-tmp"

def stock(name):
    out = TMP / name
    run(["pandoc", "-o", str(out), "--print-default-data-file", name.replace("council-", "")], check=True)
    return out

def rewrite(source, target, changes):
    with ZipFile(source) as zin, ZipFile(target, "w", ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename in changes:
                data = changes[info.filename](data.decode("utf-8")).encode("utf-8")
            zout.writestr(info, data)

def pptx():
    source = stock("reference.pptx")
    navy, indigo = "1F2937", "4F46E5"
    def theme(xml):
        xml = re.sub(r'(<a:dk2>.*?<a:srgbClr val=")[^"]+', r'\g<1>'+navy, xml, count=1)
        xml = re.sub(r'(<a:accent1>.*?<a:srgbClr val=")[^"]+', r'\g<1>'+indigo, xml, count=1)
        return xml.replace('typeface="Calibri"', 'typeface="Segoe UI"')
    def master(xml):
        xml = xml.replace('<a:schemeClr val="tx1"/>', f'<a:srgbClr val="{navy}"/>')
        xml = xml.replace('typeface="+mj-lt"', 'typeface="Segoe UI"').replace('typeface="+mn-lt"', 'typeface="Segoe UI"')
        xml = xml.replace('<a:defRPr sz="3300"', '<a:defRPr sz="3000"').replace('<a:defRPr sz="2400"', '<a:defRPr sz="2200"')
        bar = (f'<p:sp><p:nvSpPr><p:cNvPr id="90" name="Council accent bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
               f'<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="127000" cy="5143500"/></a:xfrm>'
               f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{indigo}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>')
        return xml.replace('</p:spTree>', bar + '</p:spTree>')
    def layout(xml):
        xml = xml.replace('<p:cSld name="Title Slide">', f'<p:cSld name="Title Slide"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{navy}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')
        xml = xml.replace('<p:cSld name="Section Header">', f'<p:cSld name="Section Header"><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{navy}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')
        if 'name="Title Slide"' in xml or 'name="Section Header"' in xml:
            xml = xml.replace('typeface="+mj-lt"', 'typeface="Segoe UI"').replace('typeface="+mn-lt"', 'typeface="Segoe UI"')
            xml = xml.replace('<a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr>', '<a:srgbClr val="D1D5DB"/>')
        return xml
    def presentation(xml):
        return xml.replace('cx="9144000" cy="6858000"', 'cx="12192000" cy="6858000"')
    rewrite(source, SERVICE / "council-reference.pptx", {
        "ppt/theme/theme1.xml": theme,
        "ppt/slideMasters/slideMaster1.xml": master,
        "ppt/slideLayouts/slideLayout1.xml": layout,
        "ppt/slideLayouts/slideLayout2.xml": layout,
        "ppt/presentation.xml": presentation,
    })

def docx():
    source = stock("reference.docx")
    def styles(xml):
        xml = xml.replace('w:ascii="Cambria"', 'w:ascii="Calibri"').replace('w:hAnsi="Cambria"', 'w:hAnsi="Calibri"')
        xml = xml.replace('w:asciiTheme="majorHAnsi"', 'w:ascii="Calibri"').replace('w:hAnsiTheme="majorHAnsi"', 'w:hAnsi="Calibri"')
        xml = re.sub(r'(<w:style[^>]*w:styleId="Heading[1-6]".*?<w:rPr>.*?<w:color w:val=")[^"]+', r'\g<1>1F2937', xml, flags=re.S)
        xml = re.sub(r'(<w:style[^>]*w:styleId="Normal".*?<w:sz w:val=")[^"]+', r'\g<1>22', xml, flags=re.S)
        return xml
    rewrite(source, SERVICE / "council-reference.docx", {"word/styles.xml": styles})

TMP.mkdir(exist_ok=True)
try:
    pptx(); docx()
finally:
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
