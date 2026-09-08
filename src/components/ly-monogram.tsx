import type { SVGProps } from "react";
import { LY_PATH, LY_VIEWBOX } from "@/lib/ly-monogram";

/** The original LY vector outline. Decorative beside the Le Yard name. */
export function LyMonogram(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={LY_VIEWBOX}
      width="40" height="53" fill="currentColor" aria-hidden="true"
      focusable="false" data-ly-monogram="" {...props}>
      <path fillRule="evenodd" d={LY_PATH} />
    </svg>
  );
}
