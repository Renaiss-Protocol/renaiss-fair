/** Single registration point for GSAP plugins (client-only modules import from here). */
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Flip } from "gsap/Flip";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";

gsap.registerPlugin(
  useGSAP,
  ScrollToPlugin,
  ScrollTrigger,
  Flip,
  SplitText,
  DrawSVGPlugin,
  ScrambleTextPlugin,
);

export {
  gsap,
  useGSAP,
  ScrollToPlugin,
  ScrollTrigger,
  Flip,
  SplitText,
  DrawSVGPlugin,
  ScrambleTextPlugin,
};
