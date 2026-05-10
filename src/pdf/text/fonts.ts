// Single source of truth for the Dhivehi (Thaana) fonts bundled with the
// app. Used by:
//   - the editor (CSS font-family lookups and the picker dropdown)
//   - the save pipeline (which font binary to embed for a given replacement)
//
// To add a new font: drop the .ttf into public/fonts/dhivehi/, slugify the
// filename, then add a row to FONTS below. The @font-face rules are
// generated at module load — no need to edit index.css.

export type DhivehiFont = {
  /** CSS family name used by the editor and saved PDFs. Keep it stable;
   *  the saved-PDF font registry references it. */
  family: string;
  /** Display name shown in the picker UI. */
  label: string;
  /** OS-installed names to try via `local(...)` first. The browser will
   *  prefer those over the bundled file when present. */
  localAliases: string[];
  /** Historic / alternate family names accepted by source PDFs and saved
   *  rihaPDF payloads. These are not shown as separate picker entries. */
  compatAliases?: string[];
  /** Path under `public/`. Optional — when omitted, the browser only has
   *  the OS copy via `local()` to fall back on (used for Latin/system
   *  fonts we don't bundle). */
  url?: string;
  /** Which script the font targets. Drives the per-script default
   *  (Thaana → Faruma, Latin → Arial). */
  script: "thaana" | "latin";
  /** When set, save.ts uses pdf-lib's matching StandardFont instead of
   *  trying to embed a .ttf. Used for the standard-14 Latin families
   *  that have no bundled file. */
  standardFont?: "Helvetica" | "TimesRoman" | "Courier";
};

export const FONTS: DhivehiFont[] = [
  {
    family: "A Faseyha",
    label: "A Faseyha",
    localAliases: ["A Faseyha"],
    url: "/fonts/dhivehi/faseyha.otf",
    script: "thaana",
  },
  {
    family: "A Haleem  Kirudhooni",
    label: "A Haleem  Kirudhooni",
    localAliases: ["A Haleem  Kirudhooni"],
    url: "/fonts/dhivehi/a-haleem-kirudhooni.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Bolhu Bold",
    label: "A Haleem Bolhu Bold",
    localAliases: ["A Haleem Bolhu Bold"],
    url: "/fonts/dhivehi/a-haleem-bolhu-bold.otf",
    script: "thaana",
  },
  {
    family: "A Haleem faseyha",
    label: "A Haleem faseyha",
    localAliases: ["A Haleem faseyha"],
    url: "/fonts/dhivehi/a-haleem-faseyha.otf",
    script: "thaana",
  },
  {
    family: "A Haleem KB",
    label: "A Haleem KB",
    localAliases: ["A Haleem KB"],
    url: "/fonts/dhivehi/a-haleem-kb.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Mathi Bold",
    label: "A Haleem Mathi Bold",
    localAliases: ["A Haleem Mathi Bold"],
    url: "/fonts/dhivehi/a-haleem-mathi-bold.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Raaveri",
    label: "A Haleem Raaveri",
    localAliases: ["A Haleem Raaveri"],
    url: "/fonts/dhivehi/a-haleem-raaveri.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Riveli",
    label: "A Haleem Riveli",
    localAliases: ["A Haleem Riveli"],
    url: "/fonts/dhivehi/a-haleem-riveli.otf",
    script: "thaana",
  },
  {
    family: "A Haleem SH Bold Italic",
    label: "A Haleem SH Bold Italic",
    localAliases: ["A Haleem SH Bold Italic"],
    url: "/fonts/dhivehi/a-haleem-sh-bold-italic.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Thangi Bold",
    label: "A Haleem Thangi Bold",
    localAliases: ["A Haleem Thangi Bold"],
    url: "/fonts/dhivehi/a-haleem-thangi-bold.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Thiki Bold",
    label: "A Haleem Thiki Bold",
    localAliases: ["A Haleem Thiki Bold"],
    url: "/fonts/dhivehi/a-haleem-thiki-bold.otf",
    script: "thaana",
  },
  {
    family: "A Haleem Uivashaa",
    label: "A Haleem Uivashaa",
    localAliases: ["A Haleem Uivashaa"],
    url: "/fonts/dhivehi/a-haleem-uivashaa.otf",
    script: "thaana",
  },
  {
    family: "A Ilham",
    label: "A Ilham",
    localAliases: ["A Ilham"],
    url: "/fonts/dhivehi/a-ilham.ttf",
    script: "thaana",
  },
  {
    family: "A Kaani",
    label: "A Kaani",
    localAliases: ["A Kaani"],
    url: "/fonts/dhivehi/a-kaani.otf",
    script: "thaana",
  },
  {
    family: "A Koagannu",
    label: "A Koagannu",
    localAliases: ["A Koagannu"],
    url: "/fonts/dhivehi/a-koagannu.ttf",
    script: "thaana",
  },
  {
    family: "A Lakudi",
    label: "A Lakudi",
    localAliases: ["A Lakudi"],
    url: "/fonts/dhivehi/a-lakudi.otf",
    script: "thaana",
  },
  {
    family: "A Lakudi College",
    label: "A Lakudi College",
    localAliases: ["A Lakudi College"],
    url: "/fonts/dhivehi/a-lakudi-college.otf",
    script: "thaana",
  },
  {
    family: "A Midhili",
    label: "A Midhili",
    localAliases: ["A Midhili"],
    url: "/fonts/dhivehi/a-midhili.otf",
    script: "thaana",
  },
  {
    family: "A Nishan",
    label: "A Nishan",
    localAliases: ["A Nishan"],
    url: "/fonts/dhivehi/a-nishan.ttf",
    script: "thaana",
  },
  {
    family: "A Uni",
    label: "A Uni",
    localAliases: ["A Uni"],
    url: "/fonts/dhivehi/a-uni.otf",
    script: "thaana",
  },
  {
    family: "A Utheem",
    label: "A Utheem",
    localAliases: ["A Utheem"],
    url: "/fonts/dhivehi/utheem.otf",
    script: "thaana",
  },
  {
    family: "A Waheed",
    label: "A Waheed",
    localAliases: ["A Waheed"],
    url: "/fonts/dhivehi/a-waheed.otf",
    script: "thaana",
  },
  {
    family: "A Waheed College",
    label: "A Waheed College",
    localAliases: ["A Waheed College"],
    url: "/fonts/dhivehi/a-waheed-college.otf",
    script: "thaana",
  },
  {
    family: "AammuFK",
    label: "AammuFK",
    localAliases: ["AammuFK"],
    url: "/fonts/dhivehi/aammufkf.ttf",
    script: "thaana",
  },
  {
    family: "Arial",
    label: "Arial",
    localAliases: ["Arial", "Helvetica", "Liberation Sans"],
    script: "latin",
    standardFont: "Helvetica",
  },
  {
    family: "Athu Casual",
    label: "Athu Casual",
    localAliases: ["Athu Casual"],
    url: "/fonts/dhivehi/athu-casual.otf",
    script: "thaana",
  },
  {
    family: "Avas Thaana",
    label: "Avas Thaana",
    localAliases: ["Avas Thaana"],
    url: "/fonts/dhivehi/avas-thaana.otf",
    script: "thaana",
  },
  {
    family: "BODUKURU Light",
    label: "BODUKURU Light",
    localAliases: ["BODUKURU Light"],
    url: "/fonts/dhivehi/bodukuru-light.otf",
    script: "thaana",
  },
  {
    family: "Bolhu Bold",
    label: "Bolhu Bold",
    localAliases: ["Bolhu Bold"],
    url: "/fonts/dhivehi/bolhu-bold.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu ExtraBold",
    label: "Bolhu ExtraBold",
    localAliases: ["Bolhu ExtraBold"],
    url: "/fonts/dhivehi/bolhu-extrabold.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu ExtraLight",
    label: "Bolhu ExtraLight",
    localAliases: ["Bolhu ExtraLight"],
    url: "/fonts/dhivehi/bolhu-extralight.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu Light",
    label: "Bolhu Light",
    localAliases: ["Bolhu Light"],
    url: "/fonts/dhivehi/bolhu-light.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu Medium",
    label: "Bolhu Medium",
    localAliases: ["Bolhu Medium"],
    url: "/fonts/dhivehi/bolhu-medium.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu Regular",
    label: "Bolhu Regular",
    localAliases: ["Bolhu Regular"],
    url: "/fonts/dhivehi/bolhu-regular.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu SemiBold",
    label: "Bolhu SemiBold",
    localAliases: ["Bolhu SemiBold"],
    url: "/fonts/dhivehi/bolhu-semibold.ttf",
    script: "thaana",
  },
  {
    family: "Bolhu Thin",
    label: "Bolhu Thin",
    localAliases: ["Bolhu Thin"],
    url: "/fonts/dhivehi/bolhu-thin.ttf",
    script: "thaana",
  },
  {
    family: "Courier New",
    label: "Courier New",
    localAliases: ["Courier New", "Courier", "Liberation Mono"],
    script: "latin",
    standardFont: "Courier",
  },
  {
    family: "DAM Hiyani",
    label: "DAM Hiyani",
    localAliases: ["DAM Hiyani"],
    url: "/fonts/dhivehi/dam-hiyani.otf",
    script: "thaana",
  },
  {
    family: "DAM Kalhi",
    label: "DAM Kalhi",
    localAliases: ["DAM Kalhi"],
    url: "/fonts/dhivehi/dam-kalhi.otf",
    script: "thaana",
  },
  {
    family: "DAM Kathivalhi",
    label: "DAM Kathivalhi",
    localAliases: ["DAM Kathivalhi"],
    url: "/fonts/dhivehi/dam-kathivalhi.otf",
    script: "thaana",
  },
  {
    family: "DAM Madheeh",
    label: "DAM Madheeh",
    localAliases: ["DAM Madheeh"],
    url: "/fonts/dhivehi/dam-madheeh.otf",
    script: "thaana",
  },
  {
    family: "Dhivehi",
    label: "Dhivehi",
    localAliases: ["Dhivehi"],
    url: "/fonts/dhivehi/dhivehi.ttf",
    script: "thaana",
  },
  {
    family: "Dhives",
    label: "Dhives",
    localAliases: ["Dhives"],
    url: "/fonts/dhivehi/dhives.ttf",
    script: "thaana",
  },
  {
    family: "Faagathi Dheli Light",
    label: "Faagathi Dheli Light",
    localAliases: ["Faagathi Dheli Light"],
    url: "/fonts/dhivehi/faagathidheli-light.ttf",
    script: "thaana",
  },
  {
    family: "Faagathi Dheli Regular",
    label: "Faagathi Dheli Regular",
    localAliases: ["Faagathi Dheli Regular"],
    url: "/fonts/dhivehi/faagathidheli-regular.ttf",
    script: "thaana",
  },
  {
    family: "Faagathi Neon Bold",
    label: "Faagathi Neon Bold",
    localAliases: ["Faagathi Neon Bold"],
    url: "/fonts/dhivehi/faagathineon-bold.ttf",
    script: "thaana",
  },
  {
    family: "Faagathi Neon ExtraLight",
    label: "Faagathi Neon ExtraLight",
    localAliases: ["Faagathi Neon ExtraLight"],
    url: "/fonts/dhivehi/faagathineon-extralight.ttf",
    script: "thaana",
  },
  {
    family: "Faagathi Neon Light",
    label: "Faagathi Neon Light",
    localAliases: ["Faagathi Neon Light"],
    url: "/fonts/dhivehi/faagathineon-light.ttf",
    script: "thaana",
  },
  {
    family: "Faagathi Neon Regular",
    label: "Faagathi Neon Regular",
    localAliases: ["Faagathi Neon Regular"],
    url: "/fonts/dhivehi/faagathineon-regular.ttf",
    script: "thaana",
  },
  {
    family: "Faaru Punk Bold",
    label: "Faaru Punk Bold",
    localAliases: ["Faaru Punk Bold"],
    url: "/fonts/dhivehi/faarupunk-bold.ttf",
    script: "thaana",
  },
  {
    family: "Faaru Punk Regular",
    label: "Faaru Punk Regular",
    localAliases: ["Faaru Punk Regular"],
    url: "/fonts/dhivehi/faarupunk-regular.ttf",
    script: "thaana",
  },
  {
    family: "Faiy Light",
    label: "Faiy Light",
    localAliases: ["Faiy Light"],
    url: "/fonts/dhivehi/faiy-light.otf",
    script: "thaana",
  },
  {
    family: "Fanara Black",
    label: "Fanara Black",
    localAliases: ["Fanara Black"],
    url: "/fonts/dhivehi/fanara-black.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Bold",
    label: "Fanara Bold",
    localAliases: ["Fanara Bold"],
    url: "/fonts/dhivehi/fanara-bold.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi Bold",
    label: "Fanara Golhi Bold",
    localAliases: ["Fanara Golhi Bold"],
    url: "/fonts/dhivehi/fanaragolhi-bold.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi ExtraBold",
    label: "Fanara Golhi ExtraBold",
    localAliases: ["Fanara Golhi ExtraBold"],
    url: "/fonts/dhivehi/fanaragolhi-extrabold.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi ExtraLight",
    label: "Fanara Golhi ExtraLight",
    localAliases: ["Fanara Golhi ExtraLight"],
    url: "/fonts/dhivehi/fanaragolhi-extralight.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi Light",
    label: "Fanara Golhi Light",
    localAliases: ["Fanara Golhi Light"],
    url: "/fonts/dhivehi/fanaragolhi-light.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi Medium",
    label: "Fanara Golhi Medium",
    localAliases: ["Fanara Golhi Medium"],
    url: "/fonts/dhivehi/fanaragolhi-medium.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi Regular",
    label: "Fanara Golhi Regular",
    localAliases: ["Fanara Golhi Regular"],
    url: "/fonts/dhivehi/fanaragolhi-regular.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi SemiBold",
    label: "Fanara Golhi SemiBold",
    localAliases: ["Fanara Golhi SemiBold"],
    url: "/fonts/dhivehi/fanaragolhi-semibold.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Golhi Thin",
    label: "Fanara Golhi Thin",
    localAliases: ["Fanara Golhi Thin"],
    url: "/fonts/dhivehi/fanaragolhi-thin.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Regular",
    label: "Fanara Regular",
    localAliases: ["Fanara Regular"],
    url: "/fonts/dhivehi/fanara-regular.ttf",
    script: "thaana",
  },
  {
    family: "Fanara Thin",
    label: "Fanara Thin",
    localAliases: ["Fanara Thin"],
    url: "/fonts/dhivehi/fanara-thin.ttf",
    script: "thaana",
  },
  {
    family: "Faruma",
    label: "Faruma (ModFaruma)",
    // Deliberately do not include local("Faruma"): old OS Faruma
    // installs lack the newer ModFaruma glyph coverage and would otherwise
    // override the bundled, Faruma-compatible default.
    localAliases: ["ModFaruma"],
    compatAliases: ["ModFaruma"],
    url: "/fonts/dhivehi/modfaruma.ttf",
    script: "thaana",
  },
  {
    family: "Faruma Arabic",
    label: "Faruma Arabic",
    localAliases: ["Faruma Arabic", "FarumaArabic"],
    url: "/fonts/dhivehi/faruma-arabic.ttf",
    script: "thaana",
  },
  {
    family: "Faseyha bold",
    label: "Faseyha bold",
    localAliases: ["Faseyha bold"],
    url: "/fonts/dhivehi/faseyha-bld-hinted-v2.ttf",
    script: "thaana",
  },
  {
    family: "Faseyha regular",
    label: "Faseyha regular",
    localAliases: ["Faseyha regular"],
    url: "/fonts/dhivehi/faseyha-reg-hinted-v2.ttf",
    script: "thaana",
  },
  {
    family: "Fiyuzu Regular",
    label: "Fiyuzu Regular",
    localAliases: ["Fiyuzu Regular"],
    url: "/fonts/dhivehi/fiyuzu-regular.ttf",
    script: "thaana",
  },
  {
    family: "Gurafiku Regular",
    label: "Gurafiku Regular",
    localAliases: ["Gurafiku Regular"],
    url: "/fonts/dhivehi/gurafiku-regular.ttf",
    script: "thaana",
  },
  {
    family: "Haluvidhaa Regular",
    label: "Haluvidhaa Regular",
    localAliases: ["Haluvidhaa Regular"],
    url: "/fonts/dhivehi/haluvidhaa-regular.ttf",
    script: "thaana",
  },
  {
    family: "Hawwa Regular",
    label: "Hawwa Regular",
    localAliases: ["Hawwa Regular"],
    url: "/fonts/dhivehi/hawwa-regular.ttf",
    script: "thaana",
  },
  {
    family: "Kanafala",
    label: "Kanafala",
    localAliases: ["Kanafala"],
    url: "/fonts/dhivehi/kanafala.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu Bold",
    label: "Kolhu Bold",
    localAliases: ["Kolhu Bold"],
    url: "/fonts/dhivehi/kolhu-bold.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu ExtraBold",
    label: "Kolhu ExtraBold",
    localAliases: ["Kolhu ExtraBold"],
    url: "/fonts/dhivehi/kolhu-extrabold.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu ExtraLight",
    label: "Kolhu ExtraLight",
    localAliases: ["Kolhu ExtraLight"],
    url: "/fonts/dhivehi/kolhu-extralight.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu Light",
    label: "Kolhu Light",
    localAliases: ["Kolhu Light"],
    url: "/fonts/dhivehi/kolhu-light.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu Medium",
    label: "Kolhu Medium",
    localAliases: ["Kolhu Medium"],
    url: "/fonts/dhivehi/kolhu-medium.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu Regular",
    label: "Kolhu Regular",
    localAliases: ["Kolhu Regular"],
    url: "/fonts/dhivehi/kolhu-regular.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu SemiBold",
    label: "Kolhu SemiBold",
    localAliases: ["Kolhu SemiBold"],
    url: "/fonts/dhivehi/kolhu-semibold.ttf",
    script: "thaana",
  },
  {
    family: "Kolhu Thin",
    label: "Kolhu Thin",
    localAliases: ["Kolhu Thin"],
    url: "/fonts/dhivehi/kolhu-thin.ttf",
    script: "thaana",
  },
  {
    family: "LCD Thaana Regular",
    label: "LCD Thaana Regular",
    localAliases: ["LCD Thaana Regular"],
    url: "/fonts/dhivehi/lcdthaana-regular.ttf",
    script: "thaana",
  },
  {
    family: "Masnooee Mono Regular",
    label: "Masnooee Mono Regular",
    localAliases: ["Masnooee Mono Regular"],
    url: "/fonts/dhivehi/masnooeemono-regular.ttf",
    script: "thaana",
  },
  {
    family: "Midhili bold",
    label: "Midhili bold",
    localAliases: ["Midhili bold"],
    url: "/fonts/dhivehi/midhilibold.ttf",
    script: "thaana",
  },
  {
    family: "Motaru Dhigu Regular",
    label: "Motaru Dhigu Regular",
    localAliases: ["Motaru Dhigu Regular"],
    url: "/fonts/dhivehi/motarudhigu-regular.ttf",
    script: "thaana",
  },
  {
    family: "Motaru Square Regular",
    label: "Motaru Square Regular",
    localAliases: ["Motaru Square Regular"],
    url: "/fonts/dhivehi/motarusquare-regular.ttf",
    script: "thaana",
  },
  {
    family: "MV A Waheed",
    label: "MV A Waheed",
    localAliases: ["MV A Waheed"],
    url: "/fonts/dhivehi/mvawaheed.ttf",
    script: "thaana",
  },
  {
    family: "MV Aa Randhoo",
    label: "MV Aa Randhoo",
    localAliases: ["Aa Randhoo"],
    compatAliases: ["A Randhoo Aa", "A_Randhoo-Aa"],
    url: "/fonts/dhivehi/aa-randhoo.ttf",
    script: "thaana",
  },
  {
    family: "MV Aammu Rasmy",
    label: "MV Aammu Rasmy",
    localAliases: ["Aammu F Rasmy"],
    url: "/fonts/dhivehi/aammu-f-rasmy.ttf",
    script: "thaana",
  },
  {
    family: "MV Aammu Thedhu F",
    label: "MV Aammu Thedhu F",
    localAliases: ["Aammu F Thedhu"],
    url: "/fonts/dhivehi/aammu-f-thedhu.ttf",
    script: "thaana",
  },
  {
    family: "MV Aammu Thedhu H",
    label: "MV Aammu Thedhu H",
    localAliases: ["Aammu H Thedhu"],
    url: "/fonts/dhivehi/aammu-h-thedhu.ttf",
    script: "thaana",
  },
  {
    family: "MV Aka light regular",
    label: "MV Aka light regular",
    localAliases: ["MV Aka light regular"],
    url: "/fonts/dhivehi/mv-akalight-regular.ttf",
    script: "thaana",
  },
  {
    family: "MV Akko",
    label: "MV Akko",
    localAliases: ["Akko"],
    url: "/fonts/dhivehi/akko.ttf",
    script: "thaana",
  },
  {
    family: "MV Akson",
    label: "MV Akson",
    localAliases: ["MV Akson"],
    url: "/fonts/dhivehi/mv-akson.otf",
    script: "thaana",
  },
  {
    family: "MV Alram",
    label: "MV Alram",
    localAliases: ["MV Alram"],
    url: "/fonts/dhivehi/mv-alram.ttf",
    script: "thaana",
  },
  {
    family: "Mv Amaan XP",
    label: "Mv Amaan XP",
    localAliases: ["Mv Amaan XP"],
    url: "/fonts/dhivehi/mv-amaan-xp.otf",
    script: "thaana",
  },
  {
    family: "MV Ashaahi",
    label: "MV Ashaahi",
    localAliases: ["MV Ashaahi"],
    url: "/fonts/dhivehi/mv-ashaahi.otf",
    script: "thaana",
  },
  {
    family: "MV Avas",
    label: "MV Avas",
    localAliases: ["Avas"],
    url: "/fonts/dhivehi/avas.ttf",
    script: "thaana",
  },
  {
    family: "Mv Azheel",
    label: "Mv Azheel",
    localAliases: ["Mv Azheel"],
    url: "/fonts/dhivehi/mv-azheel.ttf",
    script: "thaana",
  },
  {
    family: "Mv Azheel Regular",
    label: "Mv Azheel Regular",
    localAliases: ["Mv Azheel Regular"],
    url: "/fonts/dhivehi/mvazheel-regular.ttf",
    script: "thaana",
  },
  {
    family: "MV Beys",
    label: "MV Beys",
    localAliases: ["MV Beys"],
    url: "/fonts/dhivehi/mv-beys.otf",
    script: "thaana",
  },
  {
    family: "MV Bismi",
    label: "MV Bismi",
    localAliases: ["Bismi"],
    url: "/fonts/dhivehi/bismi.ttf",
    script: "thaana",
  },
  {
    family: "MV Boli",
    label: "MV Boli",
    localAliases: ["MV Boli", "Boli"],
    url: "/fonts/dhivehi/boli.ttf",
    script: "thaana",
  },
  {
    family: "MV Dhelifihi",
    label: "MV Dhelifihi",
    localAliases: ["MV Dhelifihi"],
    url: "/fonts/dhivehi/mv-dheli-fihi.ttf",
    script: "thaana",
  },
  {
    family: "MV Dubai",
    label: "MV Dubai",
    localAliases: ["MV Dubai"],
    url: "/fonts/dhivehi/mv-dubai.otf",
    script: "thaana",
  },
  {
    family: "Mv Eamaan XP",
    label: "Mv Eamaan XP",
    localAliases: ["Mv Eamaan XP"],
    url: "/fonts/dhivehi/mv-eamaan-xp.otf",
    script: "thaana",
  },
  {
    family: "MV Eaman XP",
    label: "MV Eaman XP",
    localAliases: ["Eaman XP", "Eamaan XP"],
    url: "/fonts/dhivehi/eaman-xp.ttf",
    script: "thaana",
  },
  {
    family: "MV Edhuru",
    label: "MV Edhuru",
    localAliases: ["MV Edhuru"],
    url: "/fonts/dhivehi/mvedhuru.ttf",
    script: "thaana",
  },
  {
    family: "MV Elaaf",
    label: "MV Elaaf",
    localAliases: ["Elaaf Normal", "Elaaf"],
    url: "/fonts/dhivehi/elaaf-normal.ttf",
    script: "thaana",
  },
  {
    family: "MV Elaaf Lite",
    label: "MV Elaaf Lite",
    localAliases: ["Elaaf Lite"],
    url: "/fonts/dhivehi/elaaf-lite.ttf",
    script: "thaana",
  },
  {
    family: "Mv Elaaf Normal",
    label: "Mv Elaaf Normal",
    localAliases: ["Mv Elaaf Normal"],
    url: "/fonts/dhivehi/mv-elaaf-normal.otf",
    script: "thaana",
  },
  {
    family: "MV Faseyha",
    label: "MV Faseyha",
    localAliases: ["MV Faseyha", "Faseyha"],
    url: "/fonts/dhivehi/faseyha.ttf",
    script: "thaana",
  },
  {
    family: "MV Faseyha Au",
    label: "MV Faseyha Au",
    localAliases: ["MV Faseyha Au"],
    url: "/fonts/dhivehi/mv-faseyha-au-rgl-h.ttf",
    script: "thaana",
  },
  {
    family: "Mv Fathimath",
    label: "Mv Fathimath",
    localAliases: ["Mv Fathimath"],
    url: "/fonts/dhivehi/mv-fathimath.ttf",
    script: "thaana",
  },
  {
    family: "Mv Gaa Lhohi",
    label: "Mv Gaa Lhohi",
    localAliases: ["Mv Gaa Lhohi"],
    url: "/fonts/dhivehi/mv-gaa-lhohi.ttf",
    script: "thaana",
  },
  {
    family: "Mv Galan Normal",
    label: "Mv Galan Normal",
    localAliases: ["Mv Galan Normal"],
    url: "/fonts/dhivehi/mv-galan-normal.otf",
    script: "thaana",
  },
  {
    family: "MV Golhifoshi",
    label: "MV Golhifoshi",
    localAliases: ["MV Golhifoshi"],
    url: "/fonts/dhivehi/mv-golhifoshi.otf",
    script: "thaana",
  },
  {
    family: "Mv GroupX Avas Akuru",
    label: "Mv GroupX Avas Akuru",
    localAliases: ["Mv GroupX Avas Akuru"],
    url: "/fonts/dhivehi/mv-groupx-avas-akuru.otf",
    script: "thaana",
  },
  {
    family: "MV Hulhumale",
    label: "MV Hulhumale",
    localAliases: ["MV Hulhumale"],
    url: "/fonts/dhivehi/mv-hulhumale.otf",
    script: "thaana",
  },
  {
    family: "MV Ilham",
    label: "MV Ilham",
    localAliases: ["Ilham"],
    url: "/fonts/dhivehi/ilham.ttf",
    script: "thaana",
  },
  {
    family: "MV Ilham bold",
    label: "MV Ilham bold",
    localAliases: ["MV Ilham bold"],
    url: "/fonts/dhivehi/mvilhambold.ttf",
    script: "thaana",
  },
  {
    family: "MV Ilham regular",
    label: "MV Ilham regular",
    localAliases: ["MV Ilham regular"],
    url: "/fonts/dhivehi/mvilhamregular.ttf",
    script: "thaana",
  },
  {
    family: "MV Iyyu",
    label: "MV Iyyu",
    localAliases: ["MV Iyyu", "Iyyu Normal"],
    url: "/fonts/dhivehi/iyyu-normal.ttf",
    script: "thaana",
  },
  {
    family: "MV Iyyu Formal",
    label: "MV Iyyu Formal",
    localAliases: ["MV Iyyu Formal", "Iyyu Formal"],
    url: "/fonts/dhivehi/iyyu-formal.ttf",
    script: "thaana",
  },
  {
    family: "MV Iyyu Nala",
    label: "MV Iyyu Nala",
    localAliases: ["MV Iyyu Nala", "Iyyu Nala"],
    url: "/fonts/dhivehi/iyyu-nala.ttf",
    script: "thaana",
  },
  {
    family: "Mv Iyyu Normal",
    label: "Mv Iyyu Normal",
    localAliases: ["Mv Iyyu Normal"],
    url: "/fonts/dhivehi/mv-iyyu-normal.otf",
    script: "thaana",
  },
  {
    family: "Mv Izy Pro",
    label: "Mv Izy Pro",
    localAliases: ["Mv Izy Pro"],
    url: "/fonts/dhivehi/mv-izy-pro.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izya regular",
    label: "Mv Izya regular",
    localAliases: ["Mv Izya regular"],
    url: "/fonts/dhivehi/mvizyaregular.ttf",
    script: "thaana",
  },
  {
    family: "MV izyan  Light",
    label: "MV izyan  Light",
    localAliases: ["MV izyan  Light"],
    url: "/fonts/dhivehi/mv-izyan-light.ttf",
    script: "thaana",
  },
  {
    family: "MV izyan athuliyun",
    label: "MV izyan athuliyun",
    localAliases: ["MV izyan athuliyun"],
    url: "/fonts/dhivehi/mv-izyan-athuliyun.ttf",
    script: "thaana",
  },
  {
    family: "MV izyan athuliyun light",
    label: "MV izyan athuliyun light",
    localAliases: ["MV izyan athuliyun light"],
    url: "/fonts/dhivehi/mv-izyan-athuliyun-light.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan bodu akuru",
    label: "Mv Izyan bodu akuru",
    localAliases: ["Mv Izyan bodu akuru"],
    url: "/fonts/dhivehi/mv-izyan-bodu-akuru.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan boduakuru 3D Bold",
    label: "Mv Izyan boduakuru 3D Bold",
    localAliases: ["Mv Izyan boduakuru 3D Bold"],
    url: "/fonts/dhivehi/mvizyanboduakuru3d-bold.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan Lhohi",
    label: "Mv Izyan Lhohi",
    localAliases: ["Mv Izyan Lhohi"],
    url: "/fonts/dhivehi/mv-izyan-lhohi.ttf",
    script: "thaana",
  },
  {
    family: "MV izyan liyun",
    label: "MV izyan liyun",
    localAliases: ["MV izyan liyun"],
    url: "/fonts/dhivehi/mv-izyan-liyun-regular.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan Normal",
    label: "Mv Izyan Normal",
    localAliases: ["Mv Izyan Normal"],
    url: "/fonts/dhivehi/mv-izyannormal.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan reethi Bold",
    label: "Mv Izyan reethi Bold",
    localAliases: ["Mv Izyan reethi Bold"],
    url: "/fonts/dhivehi/mvizyanreethi-bold.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan Suruhee",
    label: "Mv Izyan Suruhee",
    localAliases: ["Mv Izyan Suruhee"],
    url: "/fonts/dhivehi/mv-izyan-suruhee.ttf",
    script: "thaana",
  },
  {
    family: "Mv Izyan Thaana",
    label: "Mv Izyan Thaana",
    localAliases: ["Mv Izyan Thaana"],
    url: "/fonts/dhivehi/mv-izyanthaana.ttf",
    script: "thaana",
  },
  {
    family: "MV izyan thin",
    label: "MV izyan thin",
    localAliases: ["MV izyan thin"],
    url: "/fonts/dhivehi/mv-izyan-thin.ttf",
    script: "thaana",
  },
  {
    family: "MV Kanafala",
    label: "MV Kanafala",
    localAliases: ["MV Kanafala"],
    url: "/fonts/dhivehi/kanafala.otf",
    script: "thaana",
  },
  {
    family: "Mv Karudhas",
    label: "Mv Karudhas",
    localAliases: ["Mv Karudhas"],
    url: "/fonts/dhivehi/mv-karudhas.ttf",
    script: "thaana",
  },
  {
    family: "Mv karudhas Outline",
    label: "Mv karudhas Outline",
    localAliases: ["Mv karudhas Outline"],
    url: "/fonts/dhivehi/mv-karudhas-outline.ttf",
    script: "thaana",
  },
  {
    family: "Mv kashi",
    label: "Mv kashi",
    localAliases: ["Mv kashi"],
    url: "/fonts/dhivehi/mv-kashi.ttf",
    script: "thaana",
  },
  {
    family: "MV Kelaa bold",
    label: "MV Kelaa bold",
    localAliases: ["MV Kelaa bold"],
    url: "/fonts/dhivehi/mv-kelaa-bold-v1-h.ttf",
    script: "thaana",
  },
  {
    family: "MV Kelaa reg v1 h",
    label: "MV Kelaa reg v1 h",
    localAliases: ["MV Kelaa reg v1 h"],
    url: "/fonts/dhivehi/mv-kelaa-reg-v1-h.ttf",
    script: "thaana",
  },
  {
    family: "MV Koagannu",
    label: "MV Koagannu",
    localAliases: ["MV Koagannu"],
    url: "/fonts/dhivehi/mvkoagannu.ttf",
    script: "thaana",
  },
  {
    family: "MV Lady Luck",
    label: "MV Lady Luck",
    localAliases: ["Lady Luck"],
    url: "/fonts/dhivehi/lady-luck.ttf",
    script: "thaana",
  },
  {
    family: "MV Lhaiy bold",
    label: "MV Lhaiy bold",
    localAliases: ["MV Lhaiy bold"],
    url: "/fonts/dhivehi/mv-lhaiy-bold.otf",
    script: "thaana",
  },
  {
    family: "Mv lhohi",
    label: "Mv lhohi",
    localAliases: ["Mv lhohi"],
    url: "/fonts/dhivehi/mvlhohi.ttf",
    script: "thaana",
  },
  {
    family: "Mv lhohi bold",
    label: "Mv lhohi bold",
    localAliases: ["Mv lhohi bold"],
    url: "/fonts/dhivehi/mvlhohi-bold.ttf",
    script: "thaana",
  },
  {
    family: "MV MAG Round",
    label: "MV MAG Round",
    localAliases: ["MAG Round"],
    url: "/fonts/dhivehi/mag-round.ttf",
    script: "thaana",
  },
  {
    family: "Mv MAG Round Bold",
    label: "Mv MAG Round Bold",
    localAliases: ["Mv MAG Round Bold"],
    url: "/fonts/dhivehi/mv-mag-round-bold.otf",
    script: "thaana",
  },
  {
    family: "Mv MAG Round HBold",
    label: "Mv MAG Round HBold",
    localAliases: ["Mv MAG Round HBold"],
    url: "/fonts/dhivehi/mv-mag-round-hbold.otf",
    script: "thaana",
  },
  {
    family: "MV MAG Round Hollow",
    label: "MV MAG Round Hollow",
    localAliases: ["MAG Round Hollow"],
    url: "/fonts/dhivehi/mag-round-hollowttf.ttf",
    script: "thaana",
  },
  {
    family: "MV MAG Round XBold",
    label: "MV MAG Round XBold",
    localAliases: ["MAG Round XBold"],
    url: "/fonts/dhivehi/mag-round-xbold.ttf",
    script: "thaana",
  },
  {
    family: "MV maryam",
    label: "MV maryam",
    localAliases: ["MV maryam"],
    url: "/fonts/dhivehi/mv-maryam.ttf",
    script: "thaana",
  },
  {
    family: "Mv Mohamed Ali Final",
    label: "Mv Mohamed Ali Final",
    localAliases: ["Mv Mohamed Ali Final"],
    url: "/fonts/dhivehi/mv-mohamed-ali-final.ttf",
    script: "thaana",
  },
  {
    family: "MV Nasri bold",
    label: "MV Nasri bold",
    localAliases: ["MV Nasri bold"],
    url: "/fonts/dhivehi/mvnasri-bld.ttf",
    script: "thaana",
  },
  {
    family: "MV Nasri regular",
    label: "MV Nasri regular",
    localAliases: ["MV Nasri regular"],
    url: "/fonts/dhivehi/mvnasri-reg.ttf",
    script: "thaana",
  },
  {
    family: "Mv Nerumagu",
    label: "Mv Nerumagu",
    localAliases: ["Mv Nerumagu"],
    url: "/fonts/dhivehi/mv-nerumagu.ttf",
    script: "thaana",
  },
  {
    family: "Mv Nevi Raheem",
    label: "Mv Nevi Raheem",
    localAliases: ["Mv Nevi Raheem"],
    url: "/fonts/dhivehi/mv-nevi-raheem.ttf",
    script: "thaana",
  },
  {
    family: "MV Open Condensed Bold",
    label: "MV Open Condensed Bold",
    localAliases: ["MV Open Condensed Bold"],
    url: "/fonts/dhivehi/mvopencondensed-bold.ttf",
    script: "thaana",
  },
  {
    family: "MV Osho",
    label: "MV Osho",
    localAliases: ["MV Osho"],
    url: "/fonts/dhivehi/mv-osho.otf",
    script: "thaana",
  },
  {
    family: "MV Oswald reg",
    label: "MV Oswald reg",
    localAliases: ["MV Oswald reg"],
    url: "/fonts/dhivehi/mv-oswald-reg.ttf",
    script: "thaana",
  },
  {
    family: "MV Prathama Dva",
    label: "MV Prathama Dva",
    localAliases: ["MV Prathama Dva"],
    url: "/fonts/dhivehi/mv-prathama-dva.ttf",
    script: "thaana",
  },
  {
    family: "MV Prathama Ek",
    label: "MV Prathama Ek",
    localAliases: ["MV Prathama Ek"],
    url: "/fonts/dhivehi/mv-prathama-ek.ttf",
    script: "thaana",
  },
  {
    family: "MV Prathama Tin",
    label: "MV Prathama Tin",
    localAliases: ["MV Prathama Tin"],
    url: "/fonts/dhivehi/mv-prathama-tin.ttf",
    script: "thaana",
  },
  {
    family: "MV Raadha valhi bold",
    label: "MV Raadha valhi bold",
    localAliases: ["MV Raadha valhi bold"],
    url: "/fonts/dhivehi/mvraadha-bold.ttf",
    script: "thaana",
  },
  {
    family: "MV Raadha valhi regular",
    label: "MV Raadha valhi regular",
    localAliases: ["MV Raadha valhi regular"],
    url: "/fonts/dhivehi/mvraadha-regular.ttf",
    script: "thaana",
  },
  {
    family: "MV Raadhavalhi",
    label: "MV Raadhavalhi",
    localAliases: ["Raadhavalhi"],
    url: "/fonts/dhivehi/raadhavalhi.ttf",
    script: "thaana",
  },
  {
    family: "MV Raadhavalhi B",
    label: "MV Raadhavalhi B",
    localAliases: ["Raadhavalhi B"],
    url: "/fonts/dhivehi/raadhavalhi-b.ttf",
    script: "thaana",
  },
  {
    family: "MV Raadhavalhi FP",
    label: "MV Raadhavalhi FP",
    localAliases: ["Raadhavalhi FP"],
    url: "/fonts/dhivehi/raadhavalhi-fp.ttf",
    script: "thaana",
  },
  {
    family: "MV Raadhavalhi P",
    label: "MV Raadhavalhi P",
    localAliases: ["Raadhavalhi P"],
    url: "/fonts/dhivehi/raadhavalhi-p.ttf",
    script: "thaana",
  },
  {
    family: "MV Radhun",
    label: "MV Radhun",
    localAliases: ["Radhun"],
    url: "/fonts/dhivehi/radhun.ttf",
    script: "thaana",
  },
  {
    family: "MV Randhoo",
    label: "MV Randhoo",
    localAliases: ["Randhoo"],
    url: "/fonts/dhivehi/randhoo.ttf",
    script: "thaana",
  },
  {
    family: "MV Randhoo P",
    label: "MV Randhoo P",
    localAliases: ["Randhoo P"],
    url: "/fonts/dhivehi/randhoo-p.ttf",
    script: "thaana",
  },
  {
    family: "MV Reethi",
    label: "MV Reethi",
    localAliases: ["Reethi"],
    url: "/fonts/dhivehi/reethi.ttf",
    script: "thaana",
  },
  {
    family: "MV Roma",
    label: "MV Roma",
    localAliases: ["MV Roma"],
    url: "/fonts/dhivehi/mv-roma.otf",
    script: "thaana",
  },
  {
    family: "MV Runa",
    label: "MV Runa",
    localAliases: ["MV Runa"],
    url: "/fonts/dhivehi/mv-runa.otf",
    script: "thaana",
  },
  {
    family: "MV Salhi eka",
    label: "MV Salhi eka",
    localAliases: ["MV Salhi eka"],
    url: "/fonts/dhivehi/mv-salhi-eka.otf",
    script: "thaana",
  },
  {
    family: "MV Sarukitu",
    label: "MV Sarukitu",
    localAliases: ["MV Sarukitu"],
    url: "/fonts/dhivehi/mv-sarukitu.otf",
    script: "thaana",
  },
  {
    family: "MV Sehga FB",
    label: "MV Sehga FB",
    localAliases: ["Sehga FB"],
    url: "/fonts/dhivehi/sehga-fb.ttf",
    script: "thaana",
  },
  {
    family: "Mv Sehga Fubaru Fancy",
    label: "Mv Sehga Fubaru Fancy",
    localAliases: ["Mv Sehga Fubaru Fancy"],
    url: "/fonts/dhivehi/mv-sehga-fubaru-fancy.otf",
    script: "thaana",
  },
  {
    family: "Mv Sehga Old",
    label: "Mv Sehga Old",
    localAliases: ["Mv Sehga Old"],
    url: "/fonts/dhivehi/mv-sehga-old.otf",
    script: "thaana",
  },
  {
    family: "MV Sishisozo vah",
    label: "MV Sishisozo vah",
    localAliases: ["MV Sishisozo vah"],
    url: "/fonts/dhivehi/mv-sishisozo-vah.otf",
    script: "thaana",
  },
  {
    family: "Mv suruhee",
    label: "Mv suruhee",
    localAliases: ["Mv suruhee"],
    url: "/fonts/dhivehi/mv-suruhee.ttf",
    script: "thaana",
  },
  {
    family: "MV Thaana",
    label: "MV Thaana",
    localAliases: ["Thaana"],
    url: "/fonts/dhivehi/thaana.ttf",
    script: "thaana",
  },
  {
    family: "MV Thaana 1U",
    label: "MV Thaana 1U",
    localAliases: ["Thaana 1U"],
    url: "/fonts/dhivehi/thaana-1u.ttf",
    script: "thaana",
  },
  {
    family: "MV Thaana Bold",
    label: "MV Thaana Bold",
    localAliases: ["Thaana Bold"],
    url: "/fonts/dhivehi/thaana-bold.ttf",
    script: "thaana",
  },
  {
    family: "MV thaana dotmatrix 16",
    label: "MV thaana dotmatrix 16",
    localAliases: ["MV thaana dotmatrix 16"],
    url: "/fonts/dhivehi/mv-thaana-dotmatrix-16.ttf",
    script: "thaana",
  },
  {
    family: "MV thaana dotmatrix 8",
    label: "MV thaana dotmatrix 8",
    localAliases: ["MV thaana dotmatrix 8"],
    url: "/fonts/dhivehi/mv-thaana-dotmatrix-8.ttf",
    script: "thaana",
  },
  {
    family: "MV Thaanarabi",
    label: "MV Thaanarabi",
    localAliases: ["MV Thaanarabi"],
    url: "/fonts/dhivehi/mv-thaanarabi.otf",
    script: "thaana",
  },
  {
    family: "Mv Thakurufaanu",
    label: "Mv Thakurufaanu",
    localAliases: ["Mv Thakurufaanu"],
    url: "/fonts/dhivehi/mv-thakurufaanu.ttf",
    script: "thaana",
  },
  {
    family: "MV Thuththu Neo bold",
    label: "MV Thuththu Neo bold",
    localAliases: ["MV Thuththu Neo bold"],
    url: "/fonts/dhivehi/mvthuththu-neo-bold.ttf",
    script: "thaana",
  },
  {
    family: "MV Thuththu Neo reg",
    label: "MV Thuththu Neo reg",
    localAliases: ["MV Thuththu Neo reg"],
    url: "/fonts/dhivehi/mvthuththu-neo-reg.ttf",
    script: "thaana",
  },
  {
    family: "MV Typewriter",
    label: "MV Typewriter",
    localAliases: ["MV Typewriter"],
    url: "/fonts/dhivehi/mvtyper.ttf",
    script: "thaana",
  },
  {
    family: "MV Typewriter Semibold",
    label: "MV Typewriter Semibold",
    localAliases: ["MV Typewriter Semibold"],
    url: "/fonts/dhivehi/mvtypebold.ttf",
    script: "thaana",
  },
  {
    family: "MV Uligamu",
    label: "MV Uligamu",
    localAliases: ["MV Uligamu"],
    url: "/fonts/dhivehi/mvuligamu.ttf",
    script: "thaana",
  },
  {
    family: "MV Utheem",
    label: "MV Utheem",
    localAliases: ["Utheem"],
    url: "/fonts/dhivehi/utheem.ttf",
    script: "thaana",
  },
  {
    family: "MV Utheem P",
    label: "MV Utheem P",
    localAliases: ["Utheem P"],
    url: "/fonts/dhivehi/utheem-p.ttf",
    script: "thaana",
  },
  {
    family: "MV Utheemu BOLD",
    label: "MV Utheemu BOLD",
    localAliases: ["MV Utheemu BOLD"],
    url: "/fonts/dhivehi/mvutheemubold.ttf",
    script: "thaana",
  },
  {
    family: "MV Utheemu REGULAR",
    label: "MV Utheemu REGULAR",
    localAliases: ["MV Utheemu REGULAR"],
    url: "/fonts/dhivehi/mvutheemuregular.ttf",
    script: "thaana",
  },
  {
    family: "MV Vaadhoo bold",
    label: "MV Vaadhoo bold",
    localAliases: ["MV Vaadhoo bold"],
    url: "/fonts/dhivehi/mv-vaadhoo-bd-v1.0-hinted.ttf",
    script: "thaana",
  },
  {
    family: "MV Vaadhoo regular",
    label: "MV Vaadhoo regular",
    localAliases: ["MV Vaadhoo regular"],
    url: "/fonts/dhivehi/mv-vaadhoo-reg-v1.0-hinted.ttf",
    script: "thaana",
  },
  {
    family: "MV Vashalo",
    label: "MV Vashalo",
    localAliases: ["MV Vashalo"],
    url: "/fonts/dhivehi/mv-vashalo.otf",
    script: "thaana",
  },
  {
    family: "MV Waheed",
    label: "MV Waheed",
    localAliases: ["MV Waheed", "Waheed"],
    url: "/fonts/dhivehi/waheed.ttf",
    script: "thaana",
  },
  {
    family: "MV Waheed P",
    label: "MV Waheed P",
    localAliases: ["Waheed P"],
    url: "/fonts/dhivehi/waheed-p.ttf",
    script: "thaana",
  },
  {
    family: "Nasr Light",
    label: "Nasr Light",
    localAliases: ["Nasr Light"],
    url: "/fonts/dhivehi/nasr-light.otf",
    script: "thaana",
  },
  {
    family: "Noto Sans Thaana",
    label: "Noto Sans Thaana (fallback)",
    localAliases: ["Noto Sans Thaana"],
    url: "/fonts/dhivehi/noto-sans-thaana.ttf",
    script: "thaana",
  },
  {
    family: "Randhoo reg hinted",
    label: "Randhoo reg hinted",
    localAliases: ["Randhoo reg hinted"],
    url: "/fonts/dhivehi/randhoo-reg-hinted.ttf",
    script: "thaana",
  },
  {
    family: "Samee Avas Thaana",
    label: "Samee Avas Thaana",
    localAliases: ["Samee Avas Thaana"],
    url: "/fonts/dhivehi/samee-avas-thaana.ttf",
    script: "thaana",
  },
  {
    family: "Sangu Suruhee Regular",
    label: "Sangu Suruhee Regular",
    localAliases: ["Sangu Suruhee Regular"],
    url: "/fonts/dhivehi/sangusuruhee-regular.ttf",
    script: "thaana",
  },
  {
    family: "Thavaa",
    label: "Thavaa",
    localAliases: ["Thavaa"],
    url: "/fonts/dhivehi/thavaa.otf",
    script: "thaana",
  },
  {
    family: "Theras Bold",
    label: "Theras Bold",
    localAliases: ["Theras Bold"],
    url: "/fonts/dhivehi/theras-bold.ttf",
    script: "thaana",
  },
  {
    family: "Theras ExtraBold",
    label: "Theras ExtraBold",
    localAliases: ["Theras ExtraBold"],
    url: "/fonts/dhivehi/theras-extrabold.ttf",
    script: "thaana",
  },
  {
    family: "Theras ExtraLight",
    label: "Theras ExtraLight",
    localAliases: ["Theras ExtraLight"],
    url: "/fonts/dhivehi/theras-extralight.ttf",
    script: "thaana",
  },
  {
    family: "Theras Light",
    label: "Theras Light",
    localAliases: ["Theras Light"],
    url: "/fonts/dhivehi/theras-light.ttf",
    script: "thaana",
  },
  {
    family: "Theras Medium",
    label: "Theras Medium",
    localAliases: ["Theras Medium"],
    url: "/fonts/dhivehi/theras-medium.ttf",
    script: "thaana",
  },
  {
    family: "Theras Regular",
    label: "Theras Regular",
    localAliases: ["Theras Regular"],
    url: "/fonts/dhivehi/theras-regular.ttf",
    script: "thaana",
  },
  {
    family: "Theras SemiBold",
    label: "Theras SemiBold",
    localAliases: ["Theras SemiBold"],
    url: "/fonts/dhivehi/theras-semibold.ttf",
    script: "thaana",
  },
  {
    family: "Theras Thin",
    label: "Theras Thin",
    localAliases: ["Theras Thin"],
    url: "/fonts/dhivehi/theras-thin.ttf",
    script: "thaana",
  },
  {
    family: "THIKI",
    label: "THIKI",
    localAliases: ["THIKI"],
    url: "/fonts/dhivehi/thiki.ttf",
    script: "thaana",
  },
  {
    family: "Times New Roman",
    label: "Times New Roman",
    localAliases: ["Times New Roman", "Times", "Liberation Serif"],
    script: "latin",
    standardFont: "TimesRoman",
  },
  {
    family: "Viethaana Bold",
    label: "Viethaana Bold",
    localAliases: ["Viethaana Bold"],
    url: "/fonts/dhivehi/viethaana-bold.ttf",
    script: "thaana",
  },
  {
    family: "Viethaana Light",
    label: "Viethaana Light",
    localAliases: ["Viethaana Light"],
    url: "/fonts/dhivehi/viethaana-light.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu Bold",
    label: "Zaana Thedhu Bold",
    localAliases: ["Zaana Thedhu Bold"],
    url: "/fonts/dhivehi/zaanathedhu-bold.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu ExtraBold",
    label: "Zaana Thedhu ExtraBold",
    localAliases: ["Zaana Thedhu ExtraBold"],
    url: "/fonts/dhivehi/zaanathedhu-extrabold.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu ExtraLight",
    label: "Zaana Thedhu ExtraLight",
    localAliases: ["Zaana Thedhu ExtraLight"],
    url: "/fonts/dhivehi/zaanathedhu-extralight.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu Light",
    label: "Zaana Thedhu Light",
    localAliases: ["Zaana Thedhu Light"],
    url: "/fonts/dhivehi/zaanathedhu-light.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu Medium",
    label: "Zaana Thedhu Medium",
    localAliases: ["Zaana Thedhu Medium"],
    url: "/fonts/dhivehi/zaanathedhu-medium.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu Regular",
    label: "Zaana Thedhu Regular",
    localAliases: ["Zaana Thedhu Regular"],
    url: "/fonts/dhivehi/zaanathedhu-regular.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu SemiBold",
    label: "Zaana Thedhu SemiBold",
    localAliases: ["Zaana Thedhu SemiBold"],
    url: "/fonts/dhivehi/zaanathedhu-semibold.ttf",
    script: "thaana",
  },
  {
    family: "Zaana Thedhu Thin",
    label: "Zaana Thedhu Thin",
    localAliases: ["Zaana Thedhu Thin"],
    url: "/fonts/dhivehi/zaanathedhu-thin.ttf",
    script: "thaana",
  },
];

/** Default font for the editor and for replacements when nothing else
 *  is specified. Faruma is the de-facto Maldivian standard for RTL
 *  Thaana text; Arial is the fallback for Latin / English text. */
export const DEFAULT_FONT_FAMILY = "Faruma";
export const DEFAULT_LATIN_FONT_FAMILY = "Arial";

export function canonicalFontFamily(family: string): string {
  const normalized = family.toLowerCase().replace(/[-_,+\s]/g, "");
  const found = FONTS.find((f) => {
    const names = [f.family, ...(f.compatAliases ?? [])];
    return names.some((name) => name.toLowerCase().replace(/[-_,+\s]/g, "") === normalized);
  });
  return found?.family ?? family;
}

export function fontDefinitionForFamily(family: string): DhivehiFont | undefined {
  const canonical = canonicalFontFamily(family);
  return FONTS.find((f) => f.family === canonical);
}

/** CSS font-family chain we use for Thaana (only Thaana entries — never
 *  fall through to Latin fonts that lack Thaana glyphs). */
export const THAANA_FONT_STACK = [
  ...FONTS.filter((f) => f.script === "thaana").map((f) => `"${f.family}"`),
  "sans-serif",
].join(", ");

/** Coarse RTL detection: any Hebrew / Arabic / Syriac / Thaana / older
 *  RTL script codepoint marks the text as RTL for our purposes. Used
 *  to pick the right per-script default when the run's BaseFont hint
 *  isn't usable. */
export function isRtlScript(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x0590 && cp <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana
      (cp >= 0xfb1d && cp <= 0xfdff) || // Arabic Presentation Forms-A
      (cp >= 0xfe70 && cp <= 0xfeff) || // Arabic Presentation Forms-B
      (cp >= 0x10800 && cp <= 0x10fff)
    ) {
      return true;
    }
  }
  return false;
}

/** Per-script default. */
export function defaultFontForScript(text: string | null | undefined): string {
  return isRtlScript(text) ? DEFAULT_FONT_FAMILY : DEFAULT_LATIN_FONT_FAMILY;
}

/** Inject @font-face rules for every registered font. Must be called once
 *  at app startup before any Thaana-rendering happens. Idempotent. */
let injected = false;
export function injectFontFaces(): void {
  if (injected) return;
  injected = true;
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.dhivehiFonts = "true";
  let css = "";
  for (const f of FONTS) {
    const sources = [
      ...f.localAliases.map((a) => `local("${a}")`),
      ...(f.url ? [`url("${f.url}") format("truetype")`] : []),
    ].join(", ");
    if (!sources) continue;
    for (const family of [f.family, ...(f.compatAliases ?? [])]) {
      css += `@font-face { font-family: "${family}"; src: ${sources}; font-display: swap; }\n`;
    }
  }
  // Also drive the .thaana-stack utility class so component code can stay
  // declarative (`<span className="thaana-stack">`) without re-importing
  // the stack constant.
  css += `.thaana-stack { font-family: ${THAANA_FONT_STACK}; }\n`;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Cached fetch of font bytes — used by HarfBuzz / pdf-lib at save time.
 *  Latin families that point at a pdf-lib StandardFont have no bundled
 *  binary; callers must check `f.standardFont` first and skip
 *  `loadFontBytes` for those. */
const bytesCache = new Map<string, Promise<Uint8Array>>();
export function loadFontBytes(family: string): Promise<Uint8Array> {
  const cached = bytesCache.get(family);
  if (cached) return cached;
  const def = fontDefinitionForFamily(family);
  if (!def) throw new Error(`Unknown font: ${family}`);
  if (!def.url) {
    throw new Error(`Font "${family}" has no bundled .ttf — use StandardFont path`);
  }
  const url = def.url;
  const p = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  bytesCache.set(family, p);
  return p;
}

/**
 * Legacy/non-Unicode Thaana PDFs sometimes embed Type0 Identity-H fonts
 * with Latin-looking ToUnicode maps. The extracted text is ASCII-ish, but
 * the glyph program is visually Thaana. Do not route these through Arial:
 * editing Unicode replacements with a Thaana font is less wrong, and it
 * keeps the run visibly classified as Thaana-like instead of Latin.
 */
const SUSPICIOUS_LEGACY_THAANA_BASE_FONT_KEYWORDS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /vogue(?:ps)?(?:mt)?/i, family: DEFAULT_FONT_FAMILY },
  { pattern: /a[_\s-]?randhoo[_\s-]?aa|randhoo/i, family: "MV Aa Randhoo" },
];

/** Common BaseFont substrings that indicate a Latin font even when the
 *  exact family isn't in our registry. Used by resolveFamilyFromHint to
 *  route Word's "TimesNewRomanPSMT" etc. to the closest Latin family we
 *  know how to render. */
const LATIN_BASE_FONT_KEYWORDS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /timesnewroman|times-?roman/i, family: "Times New Roman" },
  { pattern: /courier/i, family: "Courier New" },
  { pattern: /helvetica|arial|liberation\s*sans|nimbus\s*sans|calibri/i, family: "Arial" },
];

/** Best-effort: given a font name reported by pdf.js / a PDF's BaseFont,
 *  return the closest matching registered family. Optional `text` lets
 *  callers feed the run's actual content so we can pick a script-
 *  appropriate default (Thaana → Faruma, Latin → Arial) when the hint
 *  doesn't match anything we know. */
export function resolveFamilyFromHint(
  hint: string | null | undefined,
  text?: string | null,
): string {
  if (!hint) return defaultFontForScript(text);
  const stripped = hint
    .replace(/^[a-z]{6}\+/i, "") // strip subset prefix like "ABCDEF+"
    .replace(/-(regular|bold|italic|oblique)$/i, "");
  const normalized = stripped.toLowerCase().replace(/[-_,+\s]/g, "");

  // Exact / substring match against a registered family or alias.
  for (const f of FONTS) {
    const aliases = [f.family, ...f.localAliases, ...(f.compatAliases ?? [])];
    for (const a of aliases) {
      const aNorm = a.toLowerCase().replace(/[-_,+\s]/g, "");
      if (aNorm === normalized || normalized.includes(aNorm)) return f.family;
    }
  }
  // Suspicious legacy Thaana fonts must win before Latin fallback because
  // their ToUnicode maps often spell ASCII while the embedded glyphs are
  // visually Thaana.
  for (const { pattern, family } of SUSPICIOUS_LEGACY_THAANA_BASE_FONT_KEYWORDS) {
    if (pattern.test(stripped)) return family;
  }
  // Latin keyword fallback for fonts we don't bundle by name (e.g.
  // "BCDEEE+TimesNewRomanPSMT" → "Times New Roman").
  for (const { pattern, family } of LATIN_BASE_FONT_KEYWORDS) {
    if (pattern.test(stripped)) return family;
  }
  // Last resort: pick the script-appropriate default.
  return defaultFontForScript(text);
}
