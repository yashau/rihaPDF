# Bundled Dhivehi (Thaana) fonts

This directory bundles 231 Thaana fonts so that rihaPDF works on machines
without Maldivian fonts installed. The browser is told to prefer the locally
installed copy via CSS `local()` first; the bundled file is only fetched as
a fallback.

## Sourcing

The bulk of the inventory was mirrored from the
[raajjefonts.github.io](https://raajjefonts.github.io/) catalogue, which is
itself a community aggregation of five upstreams:

- **dhivehi.mv archive** — older "A\_"-prefixed and "MV"-prefixed Maldivian
  fonts, many of which originated with the President's Office or the
  pre-Unicode SegaSoft / Accent Express era.
- **[hassanhameed.com](https://www.hassanhameed.com/thaana-fonts/)** —
  a long-running personal foundry by Dr. Hassan Hameed.
- **[thaana.com](https://thaana.com/)** — the Thaana Type Foundry's
  contemporary releases (Bolhu, Fanara, Kolhu, Theras, Zaana Thedhu, …).
- **[thatmaldivesblog.wordpress.com](https://thatmaldivesblog.wordpress.com/)**
  — independent display fonts (MV Akson, MV Beys, MV Roma, MV Vashalo, …).
- **[dhivehifont.com](https://dhivehifont.com/)** — a more recent indie
  foundry (Mv Izyan family, Mv Karudhas, Mv Nerumagu, MV Edhuru, …).

A smaller set is pre-bundled in rihaPDF from older Maldivian Windows
installations and has no formally documented author or license.

## Known attributions

| Family           | Attribution                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Faruma           | Mustafa Muhammad (calligraphy & design), Ibrahim Yasir (technical), Ahmed Aasif (refinement) — 2002, Office of the President        |
| ModFaruma        | See ModFaruma notes below                                                                                                           |
| MV Boli          | Thomas Rickner & Kamal Mansour (Monotype) for Microsoft — bundled with Windows since XP                                             |
| MV Reethi        | Calligraphy by Abdul Sattar, Abdulla Waheed, Mustafa Muhammad; built by Ibrahim Yasir & Ahmed Aasif — 2002, Office of the President |
| MV Waheed        | Calligraphy by Abdulla Waheed (1995); regular by Hassan Hameed; bold released 1996 with Accent Express                              |
| Noto Sans Thaana | Google LLC — SIL Open Font License 1.1                                                                                              |

### ModFaruma notes

Font metadata for `modfaruma.ttf` says: Version 2.0 Official release; created by Ibrahim Yasir, calligraphy by Musthafa Mohamed, assisted by Ahmed Asif; President's Office 2002; all rights reserved; modified for rufiyaa symbol by Kudanai, 2023. No separate license metadata is present.

The modified rufiyaa symbol is mapped to U+0024 DOLLAR SIGN (`$`), so keyboard Shift+4 selects glyph `dollar` in this font.

## If you are a rights holder

If you hold rights to any of the fonts listed below and want it removed,
re-attributed, or relicensed, please open an issue at
<https://github.com/yashau/rihaPDF/issues> or email <ibrahim@yashau.com>.
Removal requests will be honored without argument.

## Adding a new font

See **Adding a new Dhivehi font** in the top-level [README](../../../README.md).
After adding a font, also add a row to the inventory below.

## Inventory

### via raajjefonts.github.io — dhivehi.mv archive

| File                          | Family                  | Attribution / Source                                                                                                    |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `a-haleem-bolhu-bold.otf`     | A Haleem Bolhu Bold     | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Bolhu__Bold.otf)                                         |
| `a-haleem-faseyha.otf`        | A Haleem faseyha        | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_faseyha.otf)                                             |
| `a-haleem-kb.otf`             | A Haleem KB             | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_KB.otf)                                                  |
| `a-haleem-kirudhooni.otf`     | A Haleem Kirudhooni     | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem__Kirudhooni.otf)                                         |
| `a-haleem-mathi-bold.otf`     | A Haleem Mathi Bold     | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Mathi_Bold.otf)                                          |
| `a-haleem-raaveri.otf`        | A Haleem Raaveri        | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Raaveri.otf)                                             |
| `a-haleem-riveli.otf`         | A Haleem Riveli         | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Riveli.otf)                                              |
| `a-haleem-sh-bold-italic.otf` | A Haleem SH Bold Italic | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_SH_Bold_Italic.otf)                                      |
| `a-haleem-thangi-bold.otf`    | A Haleem Thangi Bold    | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Thangi_Bold.otf)                                         |
| `a-haleem-thiki-bold.otf`     | A Haleem Thiki Bold     | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Thiki_Bold.otf)                                          |
| `a-haleem-uivashaa.otf`       | A Haleem Uivashaa       | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Haleem_Uivashaa.otf)                                            |
| `a-ilham.ttf`                 | A Ilham                 | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Ilham.TTF)                                                      |
| `a-kaani.otf`                 | A Kaani                 | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Kaani.otf)                                                      |
| `a-koagannu.ttf`              | A Koagannu              | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Koagannu.TTF)                                                   |
| `a-lakudi-college.otf`        | A Lakudi College        | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Lakudi_College.otf)                                             |
| `a-lakudi.otf`                | A Lakudi                | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Lakudi.otf)                                                     |
| `a-midhili.otf`               | A Midhili               | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Midhili.otf)                                                    |
| `a-nishan.ttf`                | A Nishan                | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/A_Nishan.ttf)                                                     |
| `a-uni.otf`                   | A Uni                   | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Uni.otf)                                                        |
| `a-waheed-college.otf`        | A Waheed College        | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Waheed_College.otf)                                             |
| `a-waheed.otf`                | A Waheed                | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Waheed.otf)                                                     |
| `athu-casual.otf`             | Athu Casual             | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/Athu_Casual.otf)                                                  |
| `avas-thaana.otf`             | Avas Thaana             | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/Avas_Thaana.otf)                                                  |
| `bodukuru-light.otf`          | BODUKURU Light          | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/BODUKURU_Light.otf)                                               |
| `boli.ttf`                    | MV Boli                 | Thomas Rickner & Kamal Mansour (Monotype) for Microsoft — circa Windows XP era                                          |
| `dam-hiyani.otf`              | DAM Hiyani              | [catalogue page](https://www.dhivehi.mv/fonts/data/df/DAM_Hiyani.otf)                                                   |
| `dam-kalhi.otf`               | DAM Kalhi               | [catalogue page](https://www.dhivehi.mv/fonts/data/df/DAM_Kalhi.otf)                                                    |
| `dam-kathivalhi.otf`          | DAM Kathivalhi          | [catalogue page](https://www.dhivehi.mv/fonts/data/df/DAM_Kathivalhi.otf)                                               |
| `dam-madheeh.otf`             | DAM Madheeh             | [catalogue page](https://www.dhivehi.mv/fonts/data/df/DAM_Madheeh.otf)                                                  |
| `dhivehi.ttf`                 | Dhivehi                 | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Dhivehi.ttf)                                                      |
| `dhives.ttf`                  | Dhives                  | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/Dhives.ttf)                                                       |
| `eaman-xp.ttf`                | MV Eaman XP             | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Eamaan_XP.otf)                                                 |
| `elaaf-lite.ttf`              | MV Elaaf Lite           | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Elaaf_Lite.otf)                                                |
| `elaaf-normal.ttf`            | MV Elaaf                | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Elaaf_Normal.otf)                                              |
| `faiy-light.otf`              | Faiy Light              | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/Faiy_Light.otf)                                                   |
| `faruma.ttf`                  | Faruma                  | Mustafa Muhammad (calligraphy & design), Ibrahim Yasir (technical), Ahmed Aasif (refinement) — 2002                     |
| `modfaruma.ttf`               | ModFaruma               | See ModFaruma notes below                                                                                               |
| `faseyha.otf`                 | A Faseyha               | [catalogue page](https://www.dhivehi.mv/fonts/data/et/faseyha.otf)                                                      |
| `faseyha.ttf`                 | MV Faseyha              | [catalogue page](https://www.dhivehi.mv/fonts/data/df/MV_Faseyha.otf)                                                   |
| `iyyu-formal.ttf`             | MV Iyyu Formal          | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Iyyu_Formal.otf)                                               |
| `iyyu-nala.ttf`               | MV Iyyu Nala            | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Iyyu_Nala.otf)                                                 |
| `iyyu-normal.ttf`             | MV Iyyu                 | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Iyyu_Normal.otf)                                               |
| `kanafala.ttf`                | Kanafala                | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Kanafala.ttf)                                                     |
| `lady-luck.ttf`               | MV Lady Luck            | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Lady_Luck.otf)                                                 |
| `mag-round-hollowttf.ttf`     | MV MAG Round Hollow     | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_MAG_Round_HBold.otf)                                           |
| `mag-round-xbold.ttf`         | MV MAG Round XBold      | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_MAG_Round_XBold.otf)                                           |
| `mag-round.ttf`               | MV MAG Round            | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_MAG_Round_Bold.otf)                                            |
| `midhilibold.ttf`             | Midhili bold            | [catalogue page](https://www.dhivehi.mv/fonts/data/et/A_Midhili.otf)                                                    |
| `mv-amaan-xp.otf`             | Mv Amaan XP             | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Amaan_XP.otf)                                                  |
| `mv-eamaan-xp.otf`            | Mv Eamaan XP            | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Eamaan_XP.otf)                                                 |
| `mv-elaaf-normal.otf`         | Mv Elaaf Normal         | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Elaaf_Normal.otf)                                              |
| `mv-galan-normal.otf`         | Mv Galan Normal         | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Galan_Normal.otf)                                              |
| `mv-groupx-avas-akuru.otf`    | Mv GroupX Avas Akuru    | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_GroupX_Avas_Akuru.otf)                                         |
| `mv-iyyu-normal.otf`          | Mv Iyyu Normal          | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Iyyu_Normal.otf)                                               |
| `mv-mag-round-bold.otf`       | Mv MAG Round Bold       | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_MAG_Round_Bold.otf)                                            |
| `mv-mag-round-hbold.otf`      | Mv MAG Round HBold      | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_MAG_Round_HBold.otf)                                           |
| `mv-prathama-dva.ttf`         | MV Prathama Dva         | [catalogue page](https://www.dhivehi.mv/fonts/data/df/MV%20Prathama%20Dva.ttf)                                          |
| `mv-prathama-ek.ttf`          | MV Prathama Ek          | [catalogue page](https://www.dhivehi.mv/fonts/data/df/MV%20Prathama%20Ek.ttf)                                           |
| `mv-prathama-tin.ttf`         | MV Prathama Tin         | [catalogue page](https://www.dhivehi.mv/fonts/data/df/MV%20Prathama%20Tin.ttf)                                          |
| `mv-sehga-fubaru-fancy.otf`   | Mv Sehga Fubaru Fancy   | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Sehga_Fubaru_Fancy.otf)                                        |
| `mv-sehga-old.otf`            | Mv Sehga Old            | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Sehga_Old.otf)                                                 |
| `mvtyper.ttf`                 | MV Typewriter           | [catalogue page](https://www.dhivehi.mv/fonts/data/df/mvtyper.ttf)                                                      |
| `nasr-light.otf`              | Nasr Light              | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/Nasr_Light.otf)                                                   |
| `samee-avas-thaana.ttf`       | Samee Avas Thaana       | [catalogue page](https://www.dhivehi.mv/fonts/data/ef/Samee_Avas_Thaana.ttf)                                            |
| `sehga-fb.ttf`                | MV Sehga FB             | [catalogue page](https://www.dhivehi.mv/fonts/data/df/Mv_Sehga_Fubaru_Fancy.otf)                                        |
| `utheem.otf`                  | A Utheem                | [catalogue page](https://www.dhivehi.mv/fonts/data/et/utheem.otf)                                                       |
| `utheem.ttf`                  | MV Utheem               | [catalogue page](https://www.dhivehi.mv/fonts/data/et/utheem.otf)                                                       |
| `waheed.ttf`                  | MV Waheed               | Calligraphy by Abdulla Waheed (1995); font by Hassan Hameed (regular) and 1996 release for Accent Express (bold) — 1996 |

### via raajjefonts.github.io — Hassan Hameed (hassanhameed.com)

| File                             | Family                  | Attribution / Source                                                                                             |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `aammu-f-rasmy.ttf`              | MV Aammu Rasmy          | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-aammufk/)                                          |
| `aammufkf.ttf`                   | AammuFK                 | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-aammufk/)                                          |
| `faseyha-bld-hinted-v2.ttf`      | Faseyha bold            | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-faseyha/)                                          |
| `faseyha-reg-hinted-v2.ttf`      | Faseyha regular         | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-faseyha/)                                          |
| `ilham.ttf`                      | MV Ilham                | [catalogue page](https://www.hassanhameed.com/?page_id=5172)                                                     |
| `mv-akalight-regular.ttf`        | MV Aka light regular    | [catalogue page](https://www.hassanhameed.com/?page_id=17283)                                                    |
| `mv-faseyha-au-rgl-h.ttf`        | MV Faseyha Au           | [catalogue page](https://www.hassanhameed.com/dhivehi-language/a-font-with-an-improved-fili-system/)             |
| `mv-kelaa-bold-v1-h.ttf`         | MV Kelaa bold           | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-kelaa-thaana-font-in-regular-and-semi-bold-sizes/) |
| `mv-kelaa-reg-v1-h.ttf`          | MV Kelaa reg v1 h       | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-kelaa-thaana-font-in-regular-and-semi-bold-sizes/) |
| `mv-oswald-reg.ttf`              | MV Oswald reg           | [catalogue page](https://www.hassanhameed.com/?page_id=12764)                                                    |
| `mv-thaana-dotmatrix-16.ttf`     | MV thaana dotmatrix 16  | [catalogue page](https://www.hassanhameed.com/thaana-fonts/making-a-thaana-dot-matrix-font/)                     |
| `mv-thaana-dotmatrix-8.ttf`      | MV thaana dotmatrix 8   | [catalogue page](https://www.hassanhameed.com/thaana-fonts/making-a-thaana-dot-matrix-font/)                     |
| `mv-vaadhoo-bd-v1.0-hinted.ttf`  | MV Vaadhoo bold         | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-vaadhoo-new-thaana-font/)                          |
| `mv-vaadhoo-reg-v1.0-hinted.ttf` | MV Vaadhoo regular      | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-vaadhoo-new-thaana-font/)                          |
| `mvawaheed.ttf`                  | MV A Waheed             | [catalogue page](https://www.hassanhameed.com/thaana-fonts/a_waheed/)                                            |
| `mvilhambold.ttf`                | MV Ilham bold           | [catalogue page](https://www.hassanhameed.com/?page_id=5172)                                                     |
| `mvilhamregular.ttf`             | MV Ilham regular        | [catalogue page](https://www.hassanhameed.com/?page_id=5172)                                                     |
| `mvkoagannu.ttf`                 | MV Koagannu             | [catalogue page](https://www.hassanhameed.com/?page_id=1691)                                                     |
| `mvnasri-bld.ttf`                | MV Nasri bold           | [catalogue page](https://www.hassanhameed.com/?page_id=13342)                                                    |
| `mvnasri-reg.ttf`                | MV Nasri regular        | [catalogue page](https://www.hassanhameed.com/?page_id=13342)                                                    |
| `mvopencondensed-bold.ttf`       | MV Open Condensed Bold  | [catalogue page](https://bit.ly/2M4IetM)                                                                         |
| `mvraadha-bold.ttf`              | MV Raadha valhi bold    | [catalogue page](https://www.hassanhameed.com/?page_id=6693)                                                     |
| `mvraadha-regular.ttf`           | MV Raadha valhi regular | [catalogue page](https://www.hassanhameed.com/?page_id=6693)                                                     |
| `mvthuththu-neo-bold.ttf`        | MV Thuththu Neo bold    | [catalogue page](https://www.hassanhameed.com/?page_id=11718)                                                    |
| `mvthuththu-neo-reg.ttf`         | MV Thuththu Neo reg     | [catalogue page](https://www.hassanhameed.com/?page_id=11718)                                                    |
| `mvtypebold.ttf`                 | MV Typewriter Semibold  | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-typewriter-semibold/)                              |
| `mvuligamu.ttf`                  | MV Uligamu              | [catalogue page](https://www.hassanhameed.com/?page_id=3347)                                                     |
| `mvutheemubold.ttf`              | MV Utheemu BOLD         | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-utheemu/)                                          |
| `mvutheemuregular.ttf`           | MV Utheemu REGULAR      | [catalogue page](https://www.hassanhameed.com/thaana-fonts/mv-utheemu/)                                          |
| `raadhavalhi-b.ttf`              | MV Raadhavalhi B        | [catalogue page](https://www.hassanhameed.com/?page_id=6693)                                                     |
| `raadhavalhi.ttf`                | MV Raadhavalhi          | [catalogue page](https://www.hassanhameed.com/?page_id=6693)                                                     |
| `randhoo-reg-hinted.ttf`         | Randhoo reg hinted      | [catalogue page](https://www.hassanhameed.com/thaana-fonts/thaana-font-mv-randhoo/)                              |
| `randhoo.ttf`                    | MV Randhoo              | [catalogue page](https://www.hassanhameed.com/thaana-fonts/thaana-font-mv-randhoo/)                              |

### via raajjefonts.github.io — Thaana Type Foundry (thaana.com)

| File                          | Family                   | Attribution / Source                                 |
| ----------------------------- | ------------------------ | ---------------------------------------------------- |
| `bolhu-bold.ttf`              | Bolhu Bold               | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-extrabold.ttf`         | Bolhu ExtraBold          | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-extralight.ttf`        | Bolhu ExtraLight         | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-light.ttf`             | Bolhu Light              | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-medium.ttf`            | Bolhu Medium             | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-regular.ttf`           | Bolhu Regular            | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-semibold.ttf`          | Bolhu SemiBold           | [catalogue page](https://thaana.com/bolhu/)          |
| `bolhu-thin.ttf`              | Bolhu Thin               | [catalogue page](https://thaana.com/bolhu/)          |
| `faagathidheli-light.ttf`     | Faagathi Dheli Light     | [catalogue page](https://thaana.com/faagathi-dheli/) |
| `faagathidheli-regular.ttf`   | Faagathi Dheli Regular   | [catalogue page](https://thaana.com/faagathi-dheli/) |
| `faagathineon-bold.ttf`       | Faagathi Neon Bold       | [catalogue page](https://thaana.com/faagathi-neon/)  |
| `faagathineon-extralight.ttf` | Faagathi Neon ExtraLight | [catalogue page](https://thaana.com/faagathi-neon/)  |
| `faagathineon-light.ttf`      | Faagathi Neon Light      | [catalogue page](https://thaana.com/faagathi-neon/)  |
| `faagathineon-regular.ttf`    | Faagathi Neon Regular    | [catalogue page](https://thaana.com/faagathi-neon/)  |
| `faarupunk-bold.ttf`          | Faaru Punk Bold          | [catalogue page](https://thaana.com/faaru-punk/)     |
| `faarupunk-regular.ttf`       | Faaru Punk Regular       | [catalogue page](https://thaana.com/faaru-punk/)     |
| `fanara-black.ttf`            | Fanara Black             | [catalogue page](https://thaana.com/fanara/)         |
| `fanara-bold.ttf`             | Fanara Bold              | [catalogue page](https://thaana.com/fanara/)         |
| `fanara-regular.ttf`          | Fanara Regular           | [catalogue page](https://thaana.com/fanara/)         |
| `fanara-thin.ttf`             | Fanara Thin              | [catalogue page](https://thaana.com/fanara/)         |
| `fanaragolhi-bold.ttf`        | Fanara Golhi Bold        | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-extrabold.ttf`   | Fanara Golhi ExtraBold   | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-extralight.ttf`  | Fanara Golhi ExtraLight  | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-light.ttf`       | Fanara Golhi Light       | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-medium.ttf`      | Fanara Golhi Medium      | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-regular.ttf`     | Fanara Golhi Regular     | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-semibold.ttf`    | Fanara Golhi SemiBold    | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fanaragolhi-thin.ttf`        | Fanara Golhi Thin        | [catalogue page](https://thaana.com/fanara-golhi/)   |
| `fiyuzu-regular.ttf`          | Fiyuzu Regular           | [catalogue page](https://thaana.com/fiyuzu/)         |
| `gurafiku-regular.ttf`        | Gurafiku Regular         | [catalogue page](https://thaana.com/gurafiku/)       |
| `haluvidhaa-regular.ttf`      | Haluvidhaa Regular       | [catalogue page](https://thaana.com/haluvidhaa/)     |
| `hawwa-regular.ttf`           | Hawwa Regular            | [catalogue page](https://thaana.com/hawwa/)          |
| `kolhu-bold.ttf`              | Kolhu Bold               | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-extrabold.ttf`         | Kolhu ExtraBold          | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-extralight.ttf`        | Kolhu ExtraLight         | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-light.ttf`             | Kolhu Light              | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-medium.ttf`            | Kolhu Medium             | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-regular.ttf`           | Kolhu Regular            | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-semibold.ttf`          | Kolhu SemiBold           | [catalogue page](https://thaana.com/kolhu/)          |
| `kolhu-thin.ttf`              | Kolhu Thin               | [catalogue page](https://thaana.com/kolhu/)          |
| `lcdthaana-regular.ttf`       | LCD Thaana Regular       | [catalogue page](https://thaana.com/lcd-thaana/)     |
| `masnooeemono-regular.ttf`    | Masnooee Mono Regular    | [catalogue page](https://thaana.com/masnooee-mono/)  |
| `motarudhigu-regular.ttf`     | Motaru Dhigu Regular     | [catalogue page](https://thaana.com/motaru-dhigu/)   |
| `motarusquare-regular.ttf`    | Motaru Square Regular    | [catalogue page](https://thaana.com/motaru-square/)  |
| `sangusuruhee-regular.ttf`    | Sangu Suruhee Regular    | [catalogue page](https://thaana.com/sangu-suruhee/)  |
| `theras-bold.ttf`             | Theras Bold              | [catalogue page](https://thaana.com/theras/)         |
| `theras-extrabold.ttf`        | Theras ExtraBold         | [catalogue page](https://thaana.com/theras/)         |
| `theras-extralight.ttf`       | Theras ExtraLight        | [catalogue page](https://thaana.com/theras/)         |
| `theras-light.ttf`            | Theras Light             | [catalogue page](https://thaana.com/theras/)         |
| `theras-medium.ttf`           | Theras Medium            | [catalogue page](https://thaana.com/theras/)         |
| `theras-regular.ttf`          | Theras Regular           | [catalogue page](https://thaana.com/theras/)         |
| `theras-semibold.ttf`         | Theras SemiBold          | [catalogue page](https://thaana.com/theras/)         |
| `theras-thin.ttf`             | Theras Thin              | [catalogue page](https://thaana.com/theras/)         |
| `viethaana-bold.ttf`          | Viethaana Bold           | [catalogue page](https://thaana.com/viethaana/)      |
| `viethaana-light.ttf`         | Viethaana Light          | [catalogue page](https://thaana.com/viethaana/)      |
| `zaanathedhu-bold.ttf`        | Zaana Thedhu Bold        | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-extrabold.ttf`   | Zaana Thedhu ExtraBold   | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-extralight.ttf`  | Zaana Thedhu ExtraLight  | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-light.ttf`       | Zaana Thedhu Light       | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-medium.ttf`      | Zaana Thedhu Medium      | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-regular.ttf`     | Zaana Thedhu Regular     | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-semibold.ttf`    | Zaana Thedhu SemiBold    | [catalogue page](https://thaana.com/zaana-thedhu/)   |
| `zaanathedhu-thin.ttf`        | Zaana Thedhu Thin        | [catalogue page](https://thaana.com/zaana-thedhu/)   |

### via raajjefonts.github.io — thatmaldivesblog.wordpress.com

| File                   | Family           | Attribution / Source                                                                    |
| ---------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `kanafala.otf`         | MV Kanafala      | [catalogue page](https://thatmaldivesblog.wordpress.com/2016/04/09/new-font/)           |
| `mv-akson.otf`         | MV Akson         | [catalogue page](https://thatmaldivesblog.wordpress.com/2017/12/17/mv-akson/)           |
| `mv-ashaahi.otf`       | MV Ashaahi       | [catalogue page](https://thatmaldivesblog.wordpress.com/2018/01/28/mv-ashaahi/)         |
| `mv-beys.otf`          | MV Beys          | [catalogue page](https://thatmaldivesblog.wordpress.com/2018/07/13/mv-beys/)            |
| `mv-dubai.otf`         | MV Dubai         | [catalogue page](https://thatmaldivesblog.wordpress.com/2019/02/08/mv-dubai/)           |
| `mv-golhifoshi.otf`    | MV Golhifoshi    | [catalogue page](https://thatmaldivesblog.wordpress.com/2020/04/18/mv-golhifoshi/)      |
| `mv-hulhumale.otf`     | MV Hulhumale     | [catalogue page](https://thatmaldivesblog.wordpress.com/2018/08/26/mv-hulhumale/)       |
| `mv-lhaiy-bold.otf`    | MV Lhaiy bold    | [catalogue page](https://thatmaldivesblog.wordpress.com/2017/11/01/mv-lhaiy/)           |
| `mv-osho.otf`          | MV Osho          | [catalogue page](https://thatmaldivesblog.wordpress.com/2020/07/12/mv-osho)             |
| `mv-roma.otf`          | MV Roma          | [catalogue page](https://thatmaldivesblog.wordpress.com/2020/01/11/mv-roma/)            |
| `mv-runa.otf`          | MV Runa          | [catalogue page](https://thatmaldivesblog.wordpress.com/2020/05/10/mv-runa-mv-runa-us/) |
| `mv-salhi-eka.otf`     | MV Salhi eka     | [catalogue page](https://thatmaldivesblog.wordpress.com/2021/03/18/mv-salhi/)           |
| `mv-sarukitu.otf`      | MV Sarukitu      | [catalogue page](https://thatmaldivesblog.wordpress.com/2017/04/04/mv-sarukitu/)        |
| `mv-sishisozo-vah.otf` | MV Sishisozo vah | [catalogue page](https://thatmaldivesblog.wordpress.com/2017/01/15/mv-sishisozo/)       |
| `mv-thaanarabi.otf`    | MV Thaanarabi    | [catalogue page](https://thatmaldivesblog.wordpress.com/2016/06/08/mv_thaanarabi/)      |
| `mv-vashalo.otf`       | MV Vashalo       | [catalogue page](https://thatmaldivesblog.wordpress.com/2019/06/23/mv-vashalo/)         |
| `thavaa.otf`           | Thavaa           | [catalogue page](https://thatmaldivesblog.wordpress.com/2018/12/08/mv-thavaa/)          |

### via raajjefonts.github.io — dhivehifont.com

| File                           | Family                     | Attribution / Source                                                                                                                                                                                                                            |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mv-alram.ttf`                 | MV Alram                   | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a6%de%8d%de%b0%de%83%de%a6%de%89%de%b0/)                                                                                                   |
| `mv-azheel.ttf`                | Mv Azheel                  | [catalogue page](https://dhivehifont.com/2023/11/14/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%87%de%a6%de%92%de%b0%de%80%de%a9%de%8d%de%b0/)                                                                                                     |
| `mv-dheli-fihi.ttf`            | MV Dhelifihi               | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%8b%de%ac%de%8d%de%a8-%de%8a%de%a8%de%80%de%a8/)                                                                                                  |
| `mv-fathimath.ttf`             | Mv Fathimath               | [catalogue page](https://dhivehifont.com/2022/05/16/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%8a%de%a7%de%8c%de%a8%de%89%de%a6%de%8c%de%aa/)                                                                                                     |
| `mv-gaa-lhohi.ttf`             | Mv Gaa Lhohi               | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%8e%de%a7-%de%85%de%ae%de%80%de%a8/)                                                                                                                |
| `mv-izy-pro.ttf`               | Mv Izy Pro                 | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%87%de%a6%de%8c%de%aa%de%8d%de%a8%de%94%de%aa%de%82%de%b0/)                                      |
| `mv-izyan-athuliyun-light.ttf` | MV izyan athuliyun light   | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%87%de%a6%de%8c%de%aa%de%8d%de%a8%de%94%de%aa%de%82%de%b0-%de%8d%de%a6%de%87%de%a8%de%93%de%b0/) |
| `mv-izyan-athuliyun.ttf`       | MV izyan athuliyun         | [catalogue page](https://dhivehifont.com/2021/12/30/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%87%de%a6%de%8c%de%aa%de%8d%de%a8%de%94%de%aa%de%82%de%b0-2/)                                    |
| `mv-izyan-bodu-akuru.ttf`      | Mv Izyan bodu akuru        | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%84%de%ae%de%91%de%aa%de%87%de%a6%de%86%de%aa%de%83%de%aa/)                                      |
| `mv-izyan-lhohi.ttf`           | Mv Izyan Lhohi             | [catalogue page](https://dhivehifont.com/2024/08/13/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%87%de%a8%de%92%de%b0%de%94%de%a6%de%82%de%b0-%de%85%de%ae%de%80%de%a8/)                                                                            |
| `mv-izyan-light.ttf`           | MV izyan Light             | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%87%de%ac%de%86%de%b0%de%90%de%b0%de%93%de%b0%de%83%de%a7-%de%8d%de%a6%de%87%de%a8%de%93%de%b0/) |
| `mv-izyan-liyun-regular.ttf`   | MV izyan liyun             | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%8d%de%a8%de%94%de%aa%de%82%de%b0/)                                                              |
| `mv-izyan-suruhee.ttf`         | Mv Izyan Suruhee           | [catalogue page](https://dhivehifont.com/2022/07/25/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%87%de%a8%de%92%de%b0%de%94/)                                                                                                                       |
| `mv-izyan-thin.ttf`            | MV izyan thin              | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%8c%de%a8%de%82%de%b0/)                                                                          |
| `mv-izyannormal.ttf`           | Mv Izyan Normal            | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%82%de%af%de%89%de%a6%de%8d%de%b0/)                                                              |
| `mv-izyanthaana.ttf`           | Mv Izyan Thaana            | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%8c%de%a7%de%82%de%a6/)                                                                          |
| `mv-karudhas-outline.ttf`      | Mv karudhas Outline        | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%86%de%a6%de%83%de%aa%de%8b%de%a7%de%90%de%b0-%de%87%de%a6%de%87%de%aa%de%93%de%b0-%de%8d%de%a6%de%87%de%a8%de%82%de%b0/)                           |
| `mv-karudhas.ttf`              | Mv Karudhas                | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%86%de%a6%de%83%de%aa%de%8b%de%a7%de%90%de%b0/)                                                                                                   |
| `mv-kashi.ttf`                 | Mv kashi                   | [catalogue page](https://dhivehifont.com/2023/11/18/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%86%de%a6%de%81%de%a8/)                                                                                                                             |
| `mv-maryam.ttf`                | MV maryam                  | [catalogue page](https://dhivehifont.com/2022/05/16/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%89%de%a6%de%83%de%b0%de%94%de%a6%de%89%de%b0/)                                                                                                     |
| `mv-mohamed-ali-final.ttf`     | Mv Mohamed Ali Final       | [catalogue page](https://dhivehifont.com/2023/07/24/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%90%de%aa%de%83%de%aa%de%9a%de%a9-2/)                                                                                                               |
| `mv-nerumagu.ttf`              | Mv Nerumagu                | [catalogue page](https://dhivehifont.com/2023/04/20/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%82%de%ac%de%83%de%aa%de%89%de%a6%de%8e%de%aa/)                                                                                                     |
| `mv-nevi-raheem.ttf`           | Mv Nevi Raheem             | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%82%de%ac%de%88%de%a8-%de%83%de%a6%de%80%de%a9%de%89%de%b0/)                                                                                      |
| `mv-suruhee.ttf`               | Mv suruhee                 | [catalogue page](https://dhivehifont.com/2023/04/20/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%90%de%aa%de%83%de%aa%de%9a%de%a9/)                                                                                                                 |
| `mv-thakurufaanu.ttf`          | Mv Thakurufaanu            | [catalogue page](https://dhivehifont.com/2022/09/26/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%8c%de%a6%de%86%de%aa%de%83%de%aa%de%8a%de%a7%de%82%de%aa/)                                                                                         |
| `mvazheel-regular.ttf`         | Mv Azheel Regular          | [catalogue page](https://dhivehifont.com/2023/11/14/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%87%de%a6%de%92%de%b0%de%80%de%a9%de%8d%de%b0/)                                                                                                     |
| `mvedhuru.ttf`                 | MV Edhuru                  | [catalogue page](https://dhivehifont.com/2022/04/28/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%ac%de%8b%de%aa%de%83%de%aa/)                                                                                                               |
| `mvizyanboduakuru3d-bold.ttf`  | Mv Izyan boduakuru 3D Bold | [catalogue page](https://dhivehifont.com/2022/10/31/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%84%de%ae%de%91%de%aa%de%87%de%a6%de%86%de%aa%de%83%de%aa-3%de%91%de%a9/)                        |
| `mvizyanreethi-bold.ttf`       | Mv Izyan reethi Bold       | [catalogue page](https://dhivehifont.com/2024/01/31/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%87%de%a8%de%92%de%b0%de%94%de%a6%de%82%de%b0-%de%83%de%a9%de%8c%de%a8/)                                                                            |
| `mvizyaregular.ttf`            | Mv Izya regular            | [catalogue page](https://dhivehifont.com/2022/04/30/%de%87%de%ac-%de%89%de%b0-%de%88%de%a9-%de%87%de%a8%de%92%de%a8%de%94%de%a6%de%82%de%b0-%de%83%de%ac%de%8e%de%a8%de%87%de%aa%de%8d%de%a7%de%83/)                                            |
| `mvlhohi-bold.ttf`             | Mv lhohi bold              | [catalogue page](https://dhivehifont.com/2022/10/27/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%85%de%ae%de%80%de%a8-%de%84%de%af%de%8d%de%b0%de%91%de%b0/)                                                                                        |
| `mvlhohi.ttf`                  | Mv lhohi                   | [catalogue page](https://dhivehifont.com/2022/10/27/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%85%de%ae%de%80%de%a8-%de%84%de%af%de%8d%de%b0%de%91%de%b0/)                                                                                        |
| `thiki.ttf`                    | THIKI                      | [catalogue page](https://dhivehifont.com/2022/05/08/%de%87%de%ac%de%89%de%b0%de%88%de%a9-%de%8c%de%a8%de%86%de%a8-%de%87%de%a6%de%86%de%aa%de%83%de%aa/)                                                                                        |

### Pre-bundled (no upstream catalogue entry)

| File                   | Family            | Attribution / Source                                                                                                  |
| ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `aa-randhoo.ttf`       | MV Aa Randhoo     | Unknown                                                                                                               |
| `aammu-f-thedhu.ttf`   | MV Aammu Thedhu F | Unknown                                                                                                               |
| `aammu-h-thedhu.ttf`   | MV Aammu Thedhu H | Unknown                                                                                                               |
| `akko.ttf`             | MV Akko           | Unknown                                                                                                               |
| `avas.ttf`             | MV Avas           | Unknown                                                                                                               |
| `bismi.ttf`            | MV Bismi          | Unknown                                                                                                               |
| `noto-sans-thaana.ttf` | Noto Sans Thaana  | Google LLC — SIL Open Font License 1.1                                                                                |
| `raadhavalhi-fp.ttf`   | MV Raadhavalhi FP | Unknown                                                                                                               |
| `raadhavalhi-p.ttf`    | MV Raadhavalhi P  | Unknown                                                                                                               |
| `radhun.ttf`           | MV Radhun         | Unknown                                                                                                               |
| `randhoo-p.ttf`        | MV Randhoo P      | Unknown                                                                                                               |
| `reethi.ttf`           | MV Reethi         | Calligraphy: Abdul Sattar, Abdulla Waheed, Mustafa Muhammad. Created by Ibrahim Yasir, assisted by Ahmed Aasif — 2002 |
| `thaana-1u.ttf`        | MV Thaana 1U      | Unknown                                                                                                               |
| `thaana-bold.ttf`      | MV Thaana Bold    | Unknown                                                                                                               |
| `thaana.ttf`           | MV Thaana         | Unknown                                                                                                               |
| `utheem-p.ttf`         | MV Utheem P       | Unknown                                                                                                               |
| `waheed-p.ttf`         | MV Waheed P       | Unknown                                                                                                               |
