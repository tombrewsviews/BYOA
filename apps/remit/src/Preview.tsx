/**
 * Live preview: the white template PNG with the doc's values overlaid at the
 * SAME coordinates the exporter uses (layout.ts), scaled from PDF points to the
 * rendered image. What you see here is what buildFilledPdf produces.
 */
import React from "react";
import whitePng from "./assets/remit-template-white.png";
import signaturePng from "./assets/signature.png";
import {
  FIELDS,
  MARKS,
  PAGE,
  SIGNATURE,
  SIGN_CAPTION,
  type FieldName,
  type TextField,
} from "./layout";
import { SENDER, type RemitDoc } from "./schema";
import { activeMarks, textValues } from "./fields";

export const Preview: React.FC<{ doc: RemitDoc }> = ({ doc }) => {
  // Percent coordinates so the overlay scales with the responsive image.
  // PDF origin is bottom-left; CSS top is (1 - y/height).
  const pctX = (x: number) => `${(x / PAGE.width) * 100}%`;
  const pctTop = (y: number) => `${(1 - y / PAGE.height) * 100}%`;
  // Font size as a fraction of page height keeps text-to-form ratio on resize.
  const fontPct = (size: number) => `${(size / PAGE.height) * 100}cqh`;

  const values = textValues(doc);
  const marks = activeMarks(doc);

  return (
    <div
      className="relative mx-auto w-full max-w-[800px] bg-white shadow-sm"
      style={{ containerType: "size", aspectRatio: `${PAGE.width} / ${PAGE.height}` }}
    >
      <img src={whitePng} alt="Remittance form" className="block h-full w-full" />

      {(Object.keys(values) as FieldName[]).map((name) => {
        const v = values[name];
        if (!v) return null;
        const f: TextField = FIELDS[name];
        return (
          <div
            key={name}
            className="absolute whitespace-pre-line leading-tight text-black"
            style={{
              left: pctX(f.x),
              top: pctTop(f.y + f.size),
              fontSize: fontPct(f.size),
              fontWeight: f.bold ? 700 : 400,
              maxWidth: f.maxWidth ? pctX(f.maxWidth) : undefined,
              textAlign: f.align === "center" ? "center" : "left",
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            {v}
          </div>
        );
      })}

      {marks.map((name) => {
        const m = MARKS[name];
        return (
          <div
            key={name}
            className="absolute font-bold text-black"
            style={{
              left: pctX(m.x),
              top: pctTop(m.y + m.size / 2),
              fontSize: fontPct(m.size),
              transform: "translateX(-50%)",
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            X
          </div>
        );
      })}

      {doc.stampSignature ? (
        <>
          <div
            className="absolute whitespace-pre-line leading-tight text-black"
            style={{
              left: pctX(SIGN_CAPTION.x),
              top: pctTop(SIGN_CAPTION.y + SIGN_CAPTION.size),
              fontSize: fontPct(SIGN_CAPTION.size),
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            {SENDER.signedByCaption.join("\n")}
          </div>
          <img
            src={signaturePng}
            alt="Signature"
            className="absolute"
            style={{
              left: pctX(SIGNATURE.x),
              top: pctTop(SIGNATURE.y + SIGNATURE.height),
              width: pctX(SIGNATURE.width),
              height: `${(SIGNATURE.height / PAGE.height) * 100}%`,
              objectFit: "contain",
              objectPosition: "left bottom",
            }}
          />
        </>
      ) : null}
    </div>
  );
};
