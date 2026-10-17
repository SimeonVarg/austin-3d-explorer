# Which model built which building

The owner (2026-10-14): "There should be a list for what model built what building, for futures sake when better models come out and cheaper ones, they know what to target."

This is that list. One row per BUILD of a Blender building: a building can have several (trials, redos, fix rounds), and each building has one current best. A model that sees this file should know where it is worth trying: where the best build is by a weaker or cheaper model, where the owner scored it under 8, or where the best build has a known open fault. Scores are the owner's own numbers; a blank means he gave none. Minutes are builder time; cost is plan tokens for Claude models and dollars for paid models. Triangle counts are the saved model's. Camera says whether the camera was solved and proven on points not used in the fit (proven / loose / unproven; blank = not on file). Source says what the build was made from (Earth 3D, Street View, site photographs, a public photo, or mixed); none are named here. Status "unreviewed" is the current best build that the owner has not scored yet.

**How the retarget flag is set.** Yes when the best build is by a weaker or cheaper model than Opus 5.5; or the owner scored it under 8; or it has a known open fault (camera not proven, scale or outline off by more than about 3 m or 10%, a part missing or only inferred, name unconfirmed, whole-build colour gate failed, too many triangles for the phone); or there is no finished build yet. A fault that every build has (glass a little light, far sides inferred) does not count. Colour faults from before the standard light (2026-10-12, evening) count only when the whole build missed.

Right now: 357 builds of 297 buildings; 108 buildings flagged to retarget.

## Apartments and West Campus: best build of each building

| Building | Model | Date | Camera | Source | Status | Triangles | Minutes / cost | Owner score | Retarget |
|---|---|---|---|---|---|---|---|---|---|
| 100 Congress | Sol 6.1 | 2026-10-15 |  | public photo | unreviewed | 27,106 | 51 min, $3.00 |  | yes |
| 1609 Shoal Creek office | Sol 6.1 | 2026-10-14 | proven | public photo | unreviewed | 11,776 | 64 min, $2.61 |  | yes |
| 1836 San Jacinto | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 17,434 | 33 min, 335k plan tokens |  |  |
| 1883 at Montgomery House | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 17,974 | 38 min, 343k plan tokens |  |  |
| 1883 Cameron House | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 16,336 | 37 min, 340k plan tokens |  |  |
| 21 Pearl | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 14,432 | 44 min, 353k plan tokens |  |  |
| 21 Rio | Sonnet 5.5 | 2026-10-13 | loose | public photo | best | 16,181 | 26 min, 313k plan tokens | "Good" | yes |
| 2400 Nueces | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 36,710 | 71 min |  |  |
| 26 West | Opus 5.5 | 2026-10-12 |  | site photographs | best | 76,396 | 72 min | 8.5 |  |
| 2706 Rio Grande block (ec1b4af2) | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 23,693 | 40 min, 370k plan tokens |  |  |
| 2819 Rio Grande | Opus 5.5 | 2026-10-12 |  | site photographs | best | 22,712 | 65 min | 8.2 |  |
| 360 Condominiums | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 33,784 | 46 min, 357k plan tokens |  |  |
| Axis West Campus | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 15,939 | 40 min, 395k plan tokens |  |  |
| Banded block with light well (dbdd6dfb) | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 13,532 | 32 min, 341k plan tokens |  |  |
| Block on 25th East | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 25,552 | 37 min, 347k plan tokens |  |  |
| Block on 25th West | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 26,429 | 101 min |  |  |
| Blue and brick gallery block (6e7dec36) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 8,866 | 29 min, 324k plan tokens |  |  |
| Blue-grey gabled apartments (3f9b807a) | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 17,393 | 43 min, 407k plan tokens |  |  |
| Brick house with columned portico (319e8154) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 19,255 | 30 min, 306k plan tokens |  |  |
| Brick U-plan walk-up (071ef0d5) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 11,582 | 35 min, 356k plan tokens |  |  |
| Brown Building | Opus 5.5 | 2026-10-15 |  | Street View | unreviewed | 17,526 | 17 min, 245k plan tokens |  |  |
| Cambridge Tower | Opus 5.5 | 2026-10-16 | proven | Street View | unreviewed | 29,116 | 37 min, 394k plan tokens |  |  |
| Centennial Condominiums | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 14,722 | 49 min, 443k plan tokens |  |  |
| Cream court block with 11 chimneys (04f1466e) | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 3,215 | 38 min, 366k plan tokens |  |  |
| Crest at Pearl | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 18,688 | 53 min, 355k plan tokens |  |  |
| Delta Gamma | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 13,367 | 48 min, 675k plan tokens |  |  |
| Dobie Twenty21 | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 13,616 | 41 min, 365k plan tokens |  |  |
| Driskill Hotel | Sol 6.1 | 2026-10-15 |  | public photo | unreviewed | 35,160 | 45 min, $3.00 |  | yes |
| Ernest O. Thompson State Office Building | Sonnet 5.5 | 2026-10-15 |  | public photo | unreviewed |  | 7 min, 61k plan tokens |  | yes |
| Four Seasons Residences | Opus 5.5 | 2026-10-15 |  | mixed | unreviewed | 30,791 | 45 min, 403k plan tokens |  |  |
| Gabled walk-up (07ebbe8f) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 1,228 | 30 min, 326k plan tokens |  |  |
| GrandMarc Austin | Opus 5.5 | 2026-10-12 |  | site photographs | best | 48,464 | 75 min | 8.3 | yes |
| Greenwood Towers | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 13,594 | 38 min, 386k plan tokens |  |  |
| Hampton Inn and Suites Austin (campus) | Opus 5.5 | 2026-10-14 | unproven | public photo | unreviewed | 18,819 | 56 min, 450k plan tokens |  | yes |
| Hampton Inn and Suites Austin Downtown | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 25,994 | 49 min, 385k plan tokens |  |  |
| Hardin House | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,981 | 76 min, $3.00 |  | yes |
| HillTop | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 18,109 | 44 min, 389k plan tokens |  |  |
| Icon | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 20,804 | 64 min, 445k plan tokens |  |  |
| Inspire on 22nd | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 40,966 | 78 min |  |  |
| Ion Austin | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 7,056 | 60 min |  | yes |
| John H. Reagan State Office Building | Sonnet 5.5 | 2026-10-15 |  | public photo | unreviewed |  | 7 min, 61k plan tokens |  | yes |
| Lantern Lane Apartments | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,563 | 51 min, $2.00 |  | yes |
| Lark Austin | Opus 5.5 | 2026-10-13 | proven | mixed | unreviewed | 6,292 | 75 min, 644k plan tokens |  |  |
| Legacy on Rio | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 22,385 | 41 min, 364k plan tokens |  |  |
| Loggia block with shingle roof (90072241) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 11,701 | 34 min, 371k plan tokens |  |  |
| Mansard block with court (88dcc810) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 12,313 | 35 min, 349k plan tokens |  |  |
| Moontower | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 10,992 | 76 min |  |  |
| Noble 2500 | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 19,802 | 47 min |  |  |
| North Campus block 211c1f8e | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 15,414 | 38 min, 389k plan tokens |  |  |
| North Campus block 21fe5c30 | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 2,772 | 26 min, 313k plan tokens |  | yes |
| Norwood Tower | Sonnet 5.5 | 2026-10-15 |  | public photo | unreviewed | 27,050 | 16 min, 164k plan tokens |  | yes |
| Palmetto Apartments | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 5,629 | 25 min, 319k plan tokens |  | yes |
| Pointe on Rio | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 19,021 | 40 min |  |  |
| Price Daniel Sr. State Office Building | Sonnet 5.5 | 2026-10-15 |  | public photo | unreviewed |  | 7 min, 61k plan tokens |  | yes |
| Rambler | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 17,742 | 61 min |  |  |
| Regents West at 24th | Opus 5.5 | 2026-10-15 |  |  | unreviewed | 17,750 | 47 min, 395k plan tokens |  |  |
| Regents West at 26th | Opus 5.5 | 2026-10-14 | unproven | public photo | unreviewed | 15,887 | 52 min, 454k plan tokens |  | yes |
| Sam Houston State Office Building | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 17,549 | 13 min, 217k plan tokens |  |  |
| Seaholm Residences | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 16,338 | 35 min, 370k plan tokens |  |  |
| Signature 1909 | Opus 5.5 | 2026-10-12 |  | public photo | best | 6,953 | 76 min | "weird lines ... better text recognition" |  |
| Skyloft Austin | Opus 5.5 | 2026-10-12 |  | site photographs | best | 6,016 | 72 min | 8.6 |  |
| Stone corner block with red awning (f0b137e7) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 13,024 | 33 min, 351k plan tokens |  |  |
| Stone-base block with metal roof ring (08cca10d) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 13,563 | 38 min, 389k plan tokens |  |  |
| Texan 26 | Opus 5.5 | 2026-10-15 |  |  | unreviewed | 11,836 | 55 min, 370k plan tokens |  |  |
| Texan Pearl | Sol 6.1 | 2026-10-13 |  | public photo | best | 15,685 | 37 min, $1.71 | "Fix the slanted roofs" | yes |
| Texan Tower | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 8,320 | 48 min, 458k plan tokens |  | yes |
| Texas Law Center | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 10,352 | 45 min, 398k plan tokens |  |  |
| Texas Supreme Court Building | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 13,870 | 42 min, 372k plan tokens |  |  |
| Texas Workforce Commission Building | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 11,246 | 55 min, 379k plan tokens |  |  |
| The Austonian | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 30,504 | 43 min, 401k plan tokens |  |  |
| The Block on 23rd | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 23,149 | 38 min, 373k plan tokens |  |  |
| The Callaway House | Opus 5.5 | 2026-10-13 |  | public photo | unreviewed | 4,116 | 46 min, 397k plan tokens |  | yes |
| The Castilian | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 12,501 | 52 min |  | yes |
| The Diplomat | Opus 5.5 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,154 | 21 min, 292k plan tokens |  |  |
| The G | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 14,359 | 40 min, 366k plan tokens |  |  |
| The Independent | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 40,918 | 60 min, 591k plan tokens |  |  |
| The Mark Austin | Opus 5.5 | 2026-10-12 |  | mixed | unreviewed | 42,036 | 84 min |  |  |
| The Monarch | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 33,340 | 34 min, 355k plan tokens |  |  |
| The Nine at Rio | Sol 6.1 | 2026-10-14 | proven | public photo | unreviewed | 14,180 | 61 min, $2.27 |  | yes |
| The Nine at West Campus | Opus 5.5 | 2026-10-13 | proven | public photo | unreviewed | 14,814 | 43 min, 381k plan tokens |  |  |
| The Otis Hotel | Opus 5.5 | 2026-10-13 |  | mixed | unreviewed | 12,467 | 44 min, 387k plan tokens |  |  |
| The Quarters Grayson House | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 17,678 | 57 min, 429k plan tokens |  |  |
| The Quarters Nueces House | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 11,476 | 49 min |  |  |
| The Quarters Sterling House | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 27,018 | 39 min, 345k plan tokens |  |  |
| The Rise at West Campus | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 20,140 | 69 min |  |  |
| The Standard | Opus 5.5 | 2026-10-12 |  | mixed | best | 17,168 | 47 min | "Standard needs work" | yes |
| The Texan Shoal Creek | Sol 6.1 | 2026-10-13 |  | public photo | best | 15,565 | 21 min, $1.14 | "smooth stone detail / texture on the left tower" | yes |
| The Venue on Guadalupe | Opus 5.5 | 2026-10-12 | proven |  | best | 3,631 | 63 min | "between 8s and 9s" |  |
| Torre Student Living | Opus 5.5 | 2026-10-13 |  | mixed | unreviewed | 6,744 | 47 min, 427k plan tokens |  |  |
| Twenty Two 15 | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 13,774 | 25 min, 314k plan tokens |  |  |
| Two-wing brick block (bcf8a2ba) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 1,059 | 32 min, 364k plan tokens |  | yes |
| Union on 24th | Opus 5.5 | 2026-10-12 |  | mixed | unreviewed | 109,098 | 46 min |  | yes |
| Union on San Antonio | Opus 5.5 | 2026-10-13 |  | mixed | unreviewed | 31,114 | 56 min, 437k plan tokens |  | yes |
| Villas at San Gabriel | Opus 5.5 | 2026-10-15 |  |  | unreviewed | 21,102 | 51 min, 316k plan tokens |  |  |
| Villas on 24th | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 58,220 | 45 min |  | yes |
| Villas on Guadalupe | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 4,829 | 73 min |  | yes |
| Villas on Nueces | Opus 5.5 | 2026-10-13 | unproven | mixed | best | 3,686 | 62 min, 417k plan tokens | "C is opus ... pretty good" | yes |
| Villas on Rio | Opus 5.5 | 2026-10-12 |  | public photo | unreviewed | 15,857 | 38 min |  |  |
| W Austin | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 33,060 | 57 min, 412k plan tokens |  |  |
| Waterford Condominiums | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 13,551 | 33 min, 374k plan tokens |  |  |
| West Campus block + car-park deck (8f3cb88c) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 15,910 | 33 min, 356k plan tokens |  |  |
| West Campus block 0fe2da88 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,124 | 48 min, $2.00 |  | yes |
| West Campus block 10a07e54 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,120 | 48 min, $2.00 |  | yes |
| West Campus block 12d10e75 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,665 | 66 min, $2.00 |  | yes |
| West Campus block 1fe7267c | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 4,500 | 48 min, $2.00 |  | yes |
| West Campus block 41d7f858 | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 7,426 | 42 min, 380k plan tokens |  | yes |
| West Campus block 4e03b7f5 | Opus 5.5 | 2026-10-17 | loose | Earth 3D | unreviewed | 979 | 35 min, 330k plan tokens |  | yes |
| West Campus block 4fb09ed3 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,261 | 41 min, $2.00 |  | yes |
| West Campus block 521ab442 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,721 | 77 min, $3.00 |  | yes |
| West Campus block 619cb351 | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 4,250 | 40 min, 330k plan tokens |  | yes |
| West Campus block 732691d2 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 4,172 | 72 min, $3.00 |  | yes |
| West Campus block 73d1d197 | Opus 5.5 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,084 | 32 min, 329k plan tokens |  |  |
| West Campus block 7aacc4af | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,200 | 49 min, $2.00 |  | yes |
| West Campus block 7e7420aa | Opus 5.5 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,134 | 36 min, 366k plan tokens |  | yes |
| West Campus block 861304d8 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,518 | 71 min, $3.00 |  | yes |
| West Campus block 8c3494e9 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,800 | 50 min, $2.00 |  | yes |
| West Campus block 944d806a | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 4,269 | 31 min, 350k plan tokens |  | yes |
| West Campus block ae4909d9 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,624 | 71 min, $3.00 |  | yes |
| West Campus block aef93bb7 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,400 | 35 min, $2.00 |  | yes |
| West Campus block b01fbc20 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,729 | 42 min, $2.00 |  | yes |
| West Campus block b497d279 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,338 | 48 min, $2.00 |  | yes |
| West Campus block bb4c0263 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,600 | 42 min, $2.00 |  | yes |
| West Campus block c84206c0 | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 10,878 | 36 min, 341k plan tokens |  |  |
| West Campus block d44c18cb | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,358 | 35 min, $2.00 |  | yes |
| West Campus block d4bda8fa | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 4,357 | 47 min, $2.00 |  | yes |
| West Campus block e1b470ab | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,556 | 65 min, $3.00 |  | yes |
| West Campus block e287bfea | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 4,682 | 32 min, 348k plan tokens |  | yes |
| West Campus block with ΣΧ letters (eaca344c) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 11,724 | 30 min, 352k plan tokens |  |  |
| West Campus brick bar 8d78646f | Opus 5.5 | 2026-10-17 | loose | Earth 3D | unreviewed | 3,352 | 33 min, 331k plan tokens |  |  |
| West Campus building 18668b8d | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,877 | 59 min, $2.00 |  | yes |
| West Campus courtyard block (3b8f0f69) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 25,484 | 34 min, 367k plan tokens |  |  |
| West Campus courtyard block (bddea10c) | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 27,305 | 38 min, 370k plan tokens |  |  |
| West Campus cream block (8e99b2fe) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 16,439 | 27 min, 314k plan tokens |  |  |
| West Campus Flats | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,776 | 48 min, $2.00 |  | yes |
| West Campus long block (66d719c5) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 13,698 | 35 min, 378k plan tokens |  |  |
| West Campus pool-deck block (4fe90bd0) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 23,174 | 42 min, 395k plan tokens |  |  |
| Westgate Tower | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 24,864 | 57 min, 420k plan tokens |  |  |
| White block on stilts (5b56cd35) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 7,064 | 29 min, 329k plan tokens |  |  |
| White block with stone base (79e82c98) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 8,782 | 42 min, 389k plan tokens |  |  |
| White hip-roofed hall (a6a65d0c) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 11,924 | 27 min, 322k plan tokens |  |  |
| White stucco block on a slope (42508a4b) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 11,486 | 35 min, 373k plan tokens |  |  |
| William B. Travis State Office Building | Opus 5.5 | 2026-10-15 |  |  | unreviewed | 22,026 | 47 min, 374k plan tokens |  |  |
| William P. Clements Jr. State Office Building | Sol 6.1 | 2026-10-15 |  |  | unreviewed | 20,746 | 50 min, $3.00 |  | yes |
| Yugo Austin Nueces | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 14,022 | 71 min |  |  |
| Yugo Austin Rio | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 8,220 | 46 min |  |  |
| Yugo Austin Waterloo | Opus 5.5 | 2026-10-12 | proven | mixed | best | 4,200 | 66 min | 9 |  |
| Yugo The Corner | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 3,602 | 50 min, 417k plan tokens |  | yes |

## Campus: best build of each building

| Building | Model | Date | Camera | Source | Status | Triangles | Minutes / cost | Owner score | Retarget |
|---|---|---|---|---|---|---|---|---|---|
| Aerospace Engineering Building | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 19,700 | 45 min, 377k plan tokens |  |  |
| Almetris Duren Hall | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 19,358 | 38 min, 321k plan tokens |  |  |
| Andrews Dormitory | Opus 5.5 | 2026-10-14 | loose | public photo | unreviewed | 17,861 | 41 min, 400k plan tokens |  | yes |
| Animal Resource Center | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 15,461 | 38 min, 411k plan tokens |  |  |
| Anna Hiss Gymnasium | Opus 5.5 | 2026-10-12 |  | site photographs | best | 32,898 | 46 min | "I want the brick pattern" | yes |
| Arno Nowotny Building | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 13,817 | 49 min, 380k plan tokens |  |  |
| Art Building and Museum | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 21,524 | 34 min, 372k plan tokens |  |  |
| AT&T Executive Education and Conference Center | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 16,126 | 53 min, 454k plan tokens |  | yes |
| Austin by Ellsworth Kelly | Sonnet 5.5 | 2026-10-15 |  |  | unreviewed | 7,915 | 9 min, 174k plan tokens |  | yes |
| Austin Technology Incubator | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 491 | 32 min, 366k plan tokens |  | yes |
| Bass Concert Hall | Opus 5.5 | 2026-10-14 | unproven | public photo | unreviewed | 23,880 | 49 min, 431k plan tokens |  | yes |
| Battle Hall | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 20,068 | 33 min, 376k plan tokens |  |  |
| Bernard and Audre Rapoport Building | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 13,583 | 35 min, 336k plan tokens |  |  |
| Biological Laboratories | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 19,935 | 52 min, 415k plan tokens |  |  |
| Biomedical Engineering Building | Opus 5.5 | 2026-10-14 | loose | public photo | unreviewed | 24,046 | 47 min, 407k plan tokens |  | yes |
| Blanton Dormitory | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 17,999 | 44 min, 399k plan tokens |  |  |
| Blanton Museum of Art | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 21,870 | 61 min, 342k plan tokens |  |  |
| Brackenridge Hall | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 21,623 | 39 min, 422k plan tokens |  |  |
| Brick campus building (name unconfirmed) | Opus 5.5 | 2026-10-12 |  |  | best | 2,420 | 59 min | "between 8s and 9s" | yes |
| Brick hip-roofed court building (6f01b458) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 15,766 | 27 min, 325k plan tokens |  |  |
| Bullock Texas State History Museum | Opus 5.5 | 2026-10-13 |  | mixed | unreviewed | 29,058 | 61 min, 515k plan tokens |  |  |
| Burdine Hall | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 19,726 | 48 min, 436k plan tokens |  |  |
| Carothers Dormitory | Opus 5.5 | 2026-10-14 | loose | public photo | unreviewed | 20,879 | 44 min, 389k plan tokens |  | yes |
| Chemical and Petroleum Engineering | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 12,062 | 55 min |  |  |
| Collections Deposit Library | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 506 | 29 min, 347k plan tokens |  |  |
| Dealey Center for New Media | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 21,912 | 36 min, 360k plan tokens |  |  |
| Edgar A. Smith Building | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 8,068 | 55 min, 461k plan tokens |  |  |
| Employees Retirement System of Texas | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 17,829 | 44 min, 363k plan tokens |  |  |
| Engineering Education and Research Center | Opus 5.5 | 2026-10-16 | proven | mixed | unreviewed | 23,912 | 44 min, 404k plan tokens |  |  |
| Engineering Teaching Center II | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 22,022 | 52 min, 451k plan tokens |  | yes |
| Ernest Cockrell Jr. Hall | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 9,594 | 60 min, 473k plan tokens |  |  |
| Etter-Harbin Alumni Center | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 13,650 | 45 min, 396k plan tokens |  |  |
| Gabled courtyard complex (dd0139ea) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 11,190 | 33 min, 369k plan tokens |  |  |
| Garrison Hall | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 22,002 | 61 min, 361k plan tokens |  |  |
| Gary L. Thomas Energy Engineering Building | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 21,104 | 41 min, 367k plan tokens |  |  |
| Gates Dell Complex | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 16,632 | 42 min, 397k plan tokens |  |  |
| George H.W. Bush State Office Building | Opus 5.5 | 2026-10-15 | loose | mixed | unreviewed | 22,975 | 53 min, 378k plan tokens |  | yes |
| George I. Sanchez Building | Opus 5.5 | 2026-10-13 | unproven | public photo | best | 2,132 | 52 min, 425k plan tokens | "A is opus" | yes |
| Goldsmith Hall | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 20,544 | 37 min, 381k plan tokens |  |  |
| Goodall Wooten House | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 24,898 | 48 min, 401k plan tokens |  | yes |
| Gordon-White Building | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 19,646 | 37 min, 382k plan tokens |  |  |
| Graduate School of Business | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 7,240 | 52 min, 437k plan tokens |  |  |
| Gregory Gymnasium | Opus 5.5 | 2026-10-12 |  | site photographs | best | 7,334 | 79 min | "Nice" |  |
| Harry Ransom Center | Opus 5.5 | 2026-10-15 | proven | public photo | unreviewed | 18,100 | 57 min, 416k plan tokens |  |  |
| Health Discovery Building | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 22,780 | 55 min, 406k plan tokens |  |  |
| Hogg Memorial Auditorium | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 17,813 | 52 min, 458k plan tokens |  |  |
| Homer Rainey Hall | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 15,891 | 39 min, 394k plan tokens |  |  |
| J. T. Patterson Laboratories | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 10,542 | 55 min, 482k plan tokens |  | yes |
| Jackson Geological Sciences Building | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 20,412 | 45 min, 371k plan tokens |  |  |
| Jesse H. Jones Communication Center (A) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 18,544 | 32 min, 377k plan tokens |  |  |
| Jesse H. Jones Communication Center (B) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 16,014 | 28 min, 309k plan tokens |  |  |
| Jesse H. Jones Hall | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 21,636 | 41 min, 394k plan tokens |  |  |
| Jester East Hall | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 21,372 | 39 min, 397k plan tokens |  |  |
| John B. Connally Center for Justice | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 16,000 | 27 min, 316k plan tokens |  |  |
| John W. Hargis Hall | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 19,482 | 39 min, 361k plan tokens |  |  |
| Kinsolving Dormitory | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 24,872 | 34 min, 356k plan tokens |  |  |
| LBJ Presidential Library | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 13,602 | 40 min, 375k plan tokens |  |  |
| Lee and Joe Jamail Texas Swimming Center | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 13,916 | 34 min, 359k plan tokens |  |  |
| Littlefield Dormitory | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 22,020 | 30 min, 348k plan tokens |  |  |
| Littlefield House | Opus 5.5 | 2026-10-14 | unproven | public photo | unreviewed | 23,294 | 42 min, 413k plan tokens |  | yes |
| Mary E. Gearing Hall | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 26,811 | 62 min, 464k plan tokens |  |  |
| McCombs School of Business | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 25,031 | 52 min, 452k plan tokens |  |  |
| Moffett Molecular Biology | Opus 5.5 | 2026-10-13 |  | site photographs | best | 26,391 | 45 min, 370k plan tokens | "Make the X dots a bit more prominent" |  |
| Music Recital Hall | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 21,256 | 51 min, 398k plan tokens |  |  |
| Neural Molecular Science Building | Opus 5.5 | 2026-10-15 | proven | mixed | unreviewed | 21,790 | 59 min, 448k plan tokens |  |  |
| Norman Hackerman Building | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 6,770 | 54 min |  | yes |
| Nursing School | Sonnet 5.5 | 2026-10-15 |  | public photo | unreviewed |  | 7 min, 61k plan tokens |  | yes |
| O'Donnell Building | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 13,280 | 59 min, 500k plan tokens |  |  |
| Parlin Hall | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 18,067 | 41 min, 345k plan tokens |  |  |
| Patton Hall | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 22,941 | 35 min, 402k plan tokens |  |  |
| PCL Library | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 3,148 | 48 min, 397k plan tokens |  |  |
| Peter T. Flawn Academic Center | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 32,445 | 55 min, 426k plan tokens |  |  |
| Physics, Math and Astronomy | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 7,180 | 45 min, 383k plan tokens |  |  |
| Powers Student Activity Center | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 22,905 | 40 min, 399k plan tokens |  |  |
| Prather Hall | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 12,786 | 31 min, 354k plan tokens |  |  |
| Raku Sushi and Asian Bistro building | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 16,088 | 56 min, 381k plan tokens |  |  |
| Recreational Sports Center | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 17,971 | 32 min, 390k plan tokens |  |  |
| Robert A. Welch Hall | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 32,296 | 54 min, 473k plan tokens |  |  |
| Roberts Hall | Opus 5.5 | 2026-10-14 | loose | public photo | unreviewed | 17,954 | 44 min, 382k plan tokens |  | yes |
| Rowling Hall | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 13,189 | 70 min |  | yes |
| San Jacinto Hall | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 29,141 | 33 min, 358k plan tokens |  |  |
| Scottish Rite Dormitory | Opus 5.5 | 2026-10-14 | loose | public photo | unreviewed | 24,297 | 40 min, 364k plan tokens |  |  |
| Seay Building | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 15,404 | 52 min, 437k plan tokens |  |  |
| Sid Richardson Hall | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 15,925 | 57 min, 390k plan tokens |  |  |
| Solar-roof hall (63e601e8) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 2,042 | 37 min, 316k plan tokens |  |  |
| Stone hall with dormer gables (297fcc8d) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 1,236 | 36 min, 363k plan tokens |  |  |
| Stone hall with loggia (768ae01e) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 4,785 | 33 min, 359k plan tokens |  |  |
| Student Services Building | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 21,876 | 42 min, 446k plan tokens |  |  |
| Sutton Hall | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 21,936 | 44 min, 417k plan tokens |  |  |
| T. S. Painter Hall | Opus 5.5 | 2026-10-12 |  | site photographs | unreviewed | 16,751 | 53 min |  |  |
| Texas Cowboys Pavilion | Opus 5.5 | 2026-10-15 |  | public photo | unreviewed | 12,028 | 24 min, 232k plan tokens |  |  |
| Texas Hillel | Opus 5.5 | 2026-10-15 |  |  | unreviewed | 15,503 | 61 min, 393k plan tokens |  |  |
| Texas Memorial Museum | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 15,874 | 72 min, 364k plan tokens |  |  |
| Texas Union Building | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 26,059 | 36 min, 370k plan tokens |  |  |
| Townes Hall | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 23,390 | 38 min, 371k plan tokens |  |  |
| Travis County Civil and Family Courts | Opus 5.5 | 2026-10-14 | proven | mixed | unreviewed | 22,196 | 51 min, 436k plan tokens |  |  |
| University Catholic Center | Sol 6.1 | 2026-10-14 | proven | public photo | unreviewed | 11,957 | 62 min, $3.07 |  | yes |
| University Presbyterian Church | Opus 5.5 | 2026-10-14 | unproven | public photo | unreviewed | 14,435 | 56 min, 401k plan tokens |  | yes |
| University Teaching Center | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 19,958 | 32 min, 305k plan tokens |  |  |
| UT office block (878d9137) | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 14,184 | 31 min, 329k plan tokens |  |  |
| Waggener Hall | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 20,433 | 51 min, 436k plan tokens |  |  |
| Walter Webb Hall | Sol 6.1 | 2026-10-14 | proven | public photo | unreviewed | 14,481 | 37 min, $1.61 |  | yes |
| Will C. Hogg Building | Opus 5.5 | 2026-10-13 |  | site photographs | unreviewed | 24,386 | 55 min, 420k plan tokens |  |  |
| William Randolph Hearst Building | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 12,406 | 44 min, 319k plan tokens |  |  |

## Houses and small buildings: best build of each building

| Building | Model | Date | Camera | Source | Status | Triangles | Minutes / cost | Owner score | Retarget |
|---|---|---|---|---|---|---|---|---|---|
| Kappa Delta house | Sol 6.1 | 2026-10-13 | proven | mixed | unreviewed | 11,780 | 62 min, $3.15 |  | yes |
| Kappa Kappa Gamma house | Opus 5.5 | 2026-10-14 | proven | public photo | unreviewed | 16,029 | 51 min, 411k plan tokens |  |  |
| Pi Beta Phi house | Sol 6.1 | 2026-10-13 | proven | public photo | unreviewed | 12,076 | 62 min, $3.34 |  | yes |
| Texas Alpha Phi house | Sol 6.1 | 2026-10-13 | proven | public photo | unreviewed | 16,719 | 49 min, $2.58 |  | yes |
| University Avenue Church of Christ | Sol 6.1 | 2026-10-13 | loose | site photographs | unreviewed | 12,225 | 60 min, $2.97 |  | yes |

## Streets: best build of each building

| Building | Model | Date | Camera | Source | Status | Triangles | Minutes / cost | Owner score | Retarget |
|---|---|---|---|---|---|---|---|---|---|
| 111 Congress | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 21,394 | 31 min, 350k plan tokens |  | yes |
| 300 Colorado | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 13,484 | 33 min, 329k plan tokens |  | yes |
| 301 Congress | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 11,486 | 31 min, 371k plan tokens |  | yes |
| 405 Colorado | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 12,476 | 35 min, 346k plan tokens |  |  |
| Austin Marriott Downtown | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 6,002 | 26 min, 326k plan tokens |  | yes |
| Barbara Jordan State Office Building | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 21,114 | 44 min, 396k plan tokens |  |  |
| Block 185 | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 10,452 | 40 min, 355k plan tokens |  |  |
| Church of Scientology (Guadalupe) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 12,192 | 30 min, 344k plan tokens |  |  |
| Colorado Tower | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 20,986 | 37 min, 386k plan tokens |  |  |
| Dewitt C. Greer State Highway Building | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 25,357 | 39 min, 363k plan tokens |  |  |
| Embassy Suites Austin Downtown | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 12,268 | 41 min, 363k plan tokens |  |  |
| Fairmont Austin | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 14,049 | 38 min, 402k plan tokens |  |  |
| Frost Bank Tower | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 12,596 | 45 min, 407k plan tokens |  |  |
| Hanover Brazos Street | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 10,572 | 33 min, 326k plan tokens |  | yes |
| Hilton Austin | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 29,200 | 40 min, 382k plan tokens |  |  |
| Hotel ZaZa | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 8,980 | 35 min, 345k plan tokens |  | yes |
| Indeed Tower | Sol 6.1 | 2026-10-16 | loose | Earth 3D | unreviewed | 31,619 | 33 min |  | yes |
| JW Marriott Austin | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 19,288 | 34 min, 384k plan tokens |  | yes |
| Lyndon B. Johnson State Office Building | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 19,816 | 22 min, 287k plan tokens |  |  |
| Omni Austin Hotel Downtown | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 7,661 | 33 min, 368k plan tokens |  | yes |
| One American Center | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 24,841 | 36 min, 376k plan tokens |  | yes |
| Procore Tower | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 5,689 | 31 min, 370k plan tokens |  | yes |
| Robert E. Johnson State Legislative Office Building | Opus 5.5 | 2026-10-16 | loose | Earth 3D | best | 21,746 | 33 min, 336k plan tokens | 5 | yes |
| San Jacinto Center | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 8,961 | 37 min, 349k plan tokens |  | yes |
| Southwest Tower | Opus 5.5 | 2026-10-16 | proven | Earth 3D | unreviewed | 8,728 | 43 min, 398k plan tokens |  |  |
| Speedway (campus road), first 178 m | Opus 5.5 | 2026-10-14 |  |  | best | 8,256 | 60 min, 426k plan tokens | "The top looks super weird" | yes |
| Stephen F. Austin State Office Building | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 22,682 | 32 min, 344k plan tokens |  |  |
| Stone church on Guadalupe (27bbc14c) | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 17,662 | 32 min, 356k plan tokens |  |  |
| The Ashton | Opus 5.5 | 2026-10-16 | loose | Earth 3D | unreviewed | 27,829 | 43 min, 380k plan tokens |  |  |
| The Co-op | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 8,602 | 34 min, 346k plan tokens |  |  |
| Thompson Austin | Opus 5.5 | 2026-10-16 | unproven | Earth 3D | unreviewed | 10,144 | 36 min, 389k plan tokens |  | yes |
| West Campus building 47882601 | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 1,764 | 42 min, $2.00 |  | yes |
| West Campus building ae532cff | Sol 6.1 | 2026-10-17 | loose | Earth 3D | unreviewed | 2,219 | 59 min, $3.00 |  | yes |

## Retarget first

### The best build is by a weaker or cheaper model (try the strongest model available)

In the 2026-10-13 blind trials the owner picked the models correctly every time and ranked Opus above Sonnet above Haiku; he said decorated buildings are too hard for Sol. A better model should redo these at the same triangle budget.

- **100 Congress** (Sol 6.1, fix round): his ask: walls and corners; corners better, base changed and overhang added
- **1609 Shoal Creek office** (Sol 6.1): soffit too dark; roof +13 % vs scan (sloped lot)
- **21 Rio** (Sonnet 5.5, fix round): Sonnet detail pass on the Opus build (Opus base: 50 min, 423k plan tokens); glazed bay moved to the right face; 3.4 m recess left from the scale error
- **Austin by Ellsworth Kelly** (Sonnet 5.5, fix round): named fix: coloured glass via new fb_glass (21 panes, worst-channel error 32 -> 0.5 of 255)
- **Driskill Hotel** (Sol 6.1, fix round): his ask: detail pass; carving, surrounds, balusters added; camera still 0.6 px short
- **Ernest O. Thompson State Office Building** (Sonnet 5.5, fix round): named fix: dark_window glass on the panes the photo shows dark
- **Hardin House** (Sol 6.1): Sol on an Earth 3D package + site photographs; grey wing built flat vs hipped; court depth >1 m off
- **Indeed Tower** (Sol 6.1, fix round): Sol fix round on the Opus build at his ask: sharp mullions, glass mix, SW corner and N tip moved; camera check conditional on the new shape; cost $1.61
- **John H. Reagan State Office Building** (Sonnet 5.5, fix round): named fix: dark_window glass on the panes the photo shows dark
- **Kappa Delta house** (Sol 6.1, redo): Sol redo of the Haiku build at the same triangle budget; cheaper model, cream wall where photo is white
- **Lantern Lane Apartments** (Sol 6.1): Sol on an Earth 3D package + site photographs; overlay aligns closely; banner not built
- **Norwood Tower** (Sonnet 5.5, fix round): named fix: dark_window glass; panes 60/76/89 -> 27/32/40 vs photo 25/29/39
- **Nursing School** (Sonnet 5.5, fix round): named fix: dark_window glass on the panes the photo shows dark
- **Pi Beta Phi house** (Sol 6.1, redo): Sol redo: real portico, but sits smaller and a little turned
- **Price Daniel Sr. State Office Building** (Sonnet 5.5, fix round): named fix: dark_window glass on the panes the photo shows dark
- **Texan Pearl** (Sol 6.1, fix round): fix 1: every roof plate and canopy re-measured; shaded left wing still too dark; cheaper model (base Sol build: 70 min, $3.10)
- **Texas Alpha Phi house** (Sol 6.1, redo): Sol redo; thin iron may flicker in the app; wall under decks too dark
- **The Nine at Rio** (Sol 6.1): glass dark; base storey inferred (hidden by a hedge)
- **The Texan Shoal Creek** (Sol 6.1, fix round): fix 1 on the owner note (stone detail, slanted tower roof); tower windows still black holes; cheaper model (base Sol build: 65 min, $3.15, 9.1M tokens)
- **University Avenue Church of Christ** (Sol 6.1, redo): Sol redo; it chose its own camera limit (24 px) to pass; stone too even
- **University Catholic Center** (Sol 6.1): soffit dark; glass dark
- **Walter Webb Hall** (Sol 6.1, fix round): redo with the three checks; glass too bright
- **West Campus block 0fe2da88** (Sol 6.1): Sol on an Earth 3D package; render angle does not line up with the view; walls pale blue-white
- **West Campus block 10a07e54** (Sol 6.1): Sol on an Earth 3D package; good L plan, roof and pool; a grey slab where Earth shows parking
- **West Campus block 12d10e75** (Sol 6.1): Sol on an Earth 3D package; ridge 12.6 px off; shaded stucco and paving too dark
- **West Campus block 1fe7267c** (Sol 6.1): Sol on an Earth 3D package; built on the scan roof (outline 1.5 m off); overlay aligns; wall colours too uniform
- **West Campus block 4fb09ed3** (Sol 6.1): Sol on an Earth 3D package; two bars and court; overlay aligns; plain walls; front end may overlap a lower neighbour
- **West Campus block 521ab442** (Sol 6.1): Sol on an Earth 3D package; built on the scan roof (outline 2.7 m off); overlay aligns; brick, roofs, chimneys right
- **West Campus block 732691d2** (Sol 6.1): Sol on an Earth 3D package; overlay aligns closely; shaped gable parapets and court galleries right; grainy draft
- **West Campus block 7aacc4af** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; tree-hidden half left as blank white walls
- **West Campus block 861304d8** (Sol 6.1): Sol on an Earth 3D package; post-2021 building; overlay aligns; gables and two-tone walls right; grainy
- **West Campus block 8c3494e9** (Sol 6.1): Sol on an Earth 3D package; courtyard block; overlay aligns; grainy draft; walls too white
- **West Campus block ae4909d9** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; both masses, roof pipes and units right; grainy draft
- **West Campus block aef93bb7** (Sol 6.1): Sol on an Earth 3D package; overlay aligns well; T plan, roof, skylight right; street side inferred
- **West Campus block b01fbc20** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; roof stains and windows right; hidden face colour guessed
- **West Campus block b497d279** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; court tree built as red blobs; walls blue-white
- **West Campus block bb4c0263** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; plain bar only; neighbouring white wing outside outline
- **West Campus block d44c18cb** (Sol 6.1): Sol on an Earth 3D package; overlay aligns closely; balcony slot and base right; sign not built
- **West Campus block d4bda8fa** (Sol 6.1): Sol on an Earth 3D package; overlay aligns well; gable roofs, stone, court right; grainy draft
- **West Campus block e1b470ab** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; roof crack-seal lines and tuck-under parking right; plain walls
- **West Campus building 18668b8d** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; roof and porch right; grainy draft
- **West Campus building 47882601** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; shop strip with mural panel
- **West Campus building ae532cff** (Sol 6.1): Sol on an Earth 3D package; overlay aligns; roof, glass walls, gazebo, patio right; tent omitted
- **West Campus Flats** (Sol 6.1): Sol on an Earth 3D package; overlay aligns closely; stray black pad in the parking
- **William P. Clements Jr. State Office Building** (Sol 6.1, fix round): his ask: Sol fix round; glass, corners, arch improved

### The best build is Opus but has a known open fault

- **111 Congress**: Earth 3D; crown-corner held-outs 1.8/1.4 px pass, shape checks to 8.3 px; camera/shape split assigned after errors were seen, so loose; serrated sides too light
- **300 Colorado**: Earth 3D; two-view solve, 4 held-out pass but a 5th was dropped after its error was seen (on the front building's roof), so loose; plain glass tower, 13.5k tri vs 26k target (builder: no visible detail left)
- **301 Congress**: Earth 3D; held-out 8.4/16.7/8.7/17.0 px, no rescue tried (9t kept); tiers match scan within 0.6 m; 11.5k vs 20k
- **Andrews Dormitory**: weak camera proof; west wing hidden by an oak; east section inferred; roof pitches fitted to the scan
- **Anna Hiss Gymnasium**: owner asked for the brick pattern; lower arch springs from the ground and cuts the door top
- **AT&T Executive Education and Conference Center**: base bare (street rises 4 m); terrace, fence and sign not built; west arcade inferred
- **Austin Marriott Downtown**: Earth 3D; held-out 3.8/8.4/32.4/12.6 px, no rescue; counted teal glass mix; M logo simplified; 6k vs 24k
- **Austin Technology Incubator**: Earth 3D; 1 of 4 held-out pass; wall hue blue vs charcoal; 491 tri vs 9k target (plain box)
- **Bass Concert Hall**: camera unproven (one held-out 7.45 px; a corner moved after a miss); glass dark
- **Biomedical Engineering Building**: one held-out height corrected after a miss; 400 px main photo; glass colour off; base grey
- **Brick campus building (name unconfirmed)**: name never confirmed (matches no reference picture), not placed on the map
- **Carothers Dormitory**: held-out points re-picked twice (weak proof); stone grey; east side inferred
- **Engineering Teaching Center II**: coping 11% under the scan height; ground level not proven; glass too bright
- **George H.W. Bush State Office Building**: eye height set after a held-out miss (measured from a bollard); glass too blue; back half inferred
- **George I. Sanchez Building**: camera unproven on a far photograph; roof 22.0 m vs scan 19.1 m; a public picture may give a better camera
- **Goodall Wooten House**: dusk photos only (lamp light): wall colour guessed; columns unfluted; roof balustrade missing; sides and back not seen
- **GrandMarc Austin** (score 8.3): scored 8.3 but storey count in doubt (scan roof height unread); 48k triangles
- **Hampton Inn and Suites Austin (campus)**: camera unproven (21 px at a frame-edge corner; lens bend likely); work render; deck furniture missing
- **Hanover Brazos Street**: Earth 3D; first PROVEN camera under the camera/shape split (main-roof held-outs 2.45/6.53/5.84 px, fit 0.35 px); post-scan tower, height from storey count; red podium inferred
- **Hotel ZaZa**: Earth 3D; 2nd view held-outs all shift one way (~0.44 deg heading), main view 2.3 px; balconies too light; 9k vs 12k
- **Ion Austin**: after-sunset photograph: colours all miss; roof scale shrunk 11% late (53 to 60 m)
- **J. T. Patterson Laboratories**: stair tower position inferred, up to 7.3 m off; glass too light
- **JW Marriott Austin**: Earth 3D; 3 held-out pass but one only after a model change made after its error was seen, and R_NE sat on the neighbour; white 78.6 m tower inside the outline built too (may be a separate building); 19k vs 34k tri
- **Littlefield House**: camera unproven on an old small public photo; work render only; heights maybe 5-10 % high
- **Norman Hackerman Building**: overcast photo: colour gate failed 2 of 10, sun set by hand; wall 3.5 m off the outline
- **North Campus block 21fe5c30**: Earth 3D; 2 of 3 held-out fail (oak hides corners); plain stucco block, 2.8k tri vs 13k target; roof hue fixed (grey)
- **Omni Austin Hotel Downtown**: Earth 3D; h135 proven (4.8/7.7 px), h315 loose (27 px at east corner, outline 7 m short); roof skylights crude
- **One American Center**: Earth 3D; held-out 3 of 5 (8.7, 11.9 miss); stepped crowns right; shade 26-40% dark; 24.8k vs 30k
- **Palmetto Apartments**: Earth 3D + site photographs; held-out 23.6 px at SW corner; site photo got no camera (one independent corner); roof colour from site photos; windows read blue; courtyard simplified
- **Procore Tower**: Earth 3D; 3 held-out pass, 4th 85 px (pick above body top); dark glass hue brown vs grey-blue; 5.7k vs 12k
- **Regents West at 26th**: camera unproven (stair bay vs survey); stucco too dark; east wing thin
- **Robert E. Johnson State Legislative Office Building** (score 5): no score yet; Earth 3D only; h225 proven, h045 (main) not; teal glass too dark
- **Roberts Hall**: camera passed after post-hoc held-out fixes; brick and stone a bit dark; other wings from an aerial
- **Rowling Hall**: fins miss the colour gate by 65%; south wing and street sides inferred
- **San Jacinto Center**: Earth 3D; main-mass held-outs 1.9-13.7 px; shape checks 0.9-1.9 m; shade 45% dark; 9k vs 14k
- **Speedway (campus road), first 178 m**: trees bad (thick black trunks, grey ceiling), west terrace, stairs and rails missing; round 2 cancelled by the owner
- **Texan Tower**: name not confirmed (no readable sign); heights 6-9% under the scan
- **The Callaway House**: colour level weakly anchored (k 10.8 vs 18.9); stepped corner box not built
- **The Castilian**: dusk photograph: render dark and blue, colours miss
- **The Standard**: owner said it needs work; tower glass near black; outline 4-6 m short on the south
- **Thompson Austin**: Earth 3D; held-out 2.6/25.1/11.1/22.3 px (street slope); roof heights match scan; glass flat vs ribbed; 10k tri vs 22k target
- **Two-wing brick block (bcf8a2ba)**: rough; Earth 3D only; held-out 1 of 5; galleries read as scaffolding; wing-end gables wrong; walls too light; 1,059 tri
- **Union on 24th**: 109k triangles is too many for the phone; north court guessed; needs a lean copy
- **Union on San Antonio**: tower too pale and plainer than the photograph; tower height 92.7 m vs notes 101 m (older app version scored 8.3)
- **University Presbyterian Church**: camera unproven (lines disagree); door surround spiky; wings plain boxes
- **Villas on 24th**: dawn photograph: all 28 colour places miss, render 5x too dark; 58k triangles; not replaced
- **Villas on Guadalupe**: weak build; worst wall stretch 7.3 m off the outline; roofs wrong
- **Villas on Nueces**: owner: pretty good; camera unproven (a corner 1.8 m off); street face 1.8 m inside the outline; base storeys and Nueces face have no openings
- **West Campus block 41d7f858**: Earth 3D; held-outs on 4 chimney tops at scan height 0.85-1.43 px (all one height); walls moved 1.3 m onto the scan roof; fewer cross hips than the views
- **West Campus block 4e03b7f5**: Earth 3D; SW wing rebuilt on a lead-asked pass; 1 held-out 52.8 px on a tree-hidden corner; east part inferred
- **West Campus block 619cb351**: Earth 3D; held-out 10.1/20.9/41.6 px; gables fixed on two lead-asked passes (cap bug, then width); court 8 m wider than survey
- **West Campus block 7e7420aa**: Earth 3D; held-outs 11.9/8.9/10.3 px and fit set changed after seeing them (loose); Dutch gables from a soft mesh
- **West Campus block 944d806a**: Earth 3D; 3 of 4 camera held-outs miss (Earth court ~1-1.5 m east of scan); walls on scan roof 2.75 m east of map; outline includes a white house (house_* objects), may be separate
- **West Campus block e287bfea**: Earth 3D; held-out 1.98/26.1/19.8 px: survey outline 2 m wider than the mesh at the west end; gallery bands too pale; 4.7k vs 9k
- **Yugo The Corner**: two far photographs only; north-east panel block not built; east base 3.4 m outside the scan

### No finished build yet

- **University Christian Church**: retries 2+3: outline misread fixed, heights within 1% of scan, crown right; camera still not proven (54/54 px, likely a pavement drop); parked after 3 tries
- **Austin Proper**: downtown lane; camera fit passed but the build does not match the photo (terraces, podium); main photo blocked by a bridge arch and wires, a 2x crop; height 18% off; not sent
- **Turtle Pond and Memorial Garden**: first ground piece; camera not proven (12.7/19.6 px); close-up photo, wrong scale for the city; not sent
- **Heinsohn Hall**: independent retry: held-out pass but all on one flat face; camera height 0.44 m (implausible); porthole wall 1.5x tall; not sent; PARKED (2 tries)
- **Dorothy Gebauer Building**: three early stops (oaks; floating camera; scale free with one panorama position); PARKED; parapet ~3 m over the roof deck
- **The Block on Pearl (south)**: parked: Earth 3D only; held-out fails (one pick on the wrong edge); massing reads wrong next to Earth; 800 px draft only; not sent
- **Block on Pearl north (064e7194)**: parked, not sent: very noisy 16-sample draft, mansards and blue walls far too dark, massing reads heavier than Earth; same complex as the parked Pearl south
- **West Campus block a06cb507**: Sol on a weak Earth package (34% of frame, oaks); angle off; roofs rough; blue pads

### Good test set for a cheaper model

Small Opus builds (8,000 triangles or fewer) with no open fault: a new cheap model can be tried on these first, at the same triangle number, and compared blind against the Opus build. Collections Deposit Library (506 tri); Cream court block with 11 chimneys (04f1466e) (3,215 tri); Gabled walk-up (07ebbe8f) (1,228 tri); Graduate School of Business (7,240 tri); Gregory Gymnasium (7,334 tri); Lark Austin (6,292 tri); PCL Library (3,148 tri); Physics, Math and Astronomy (7,180 tri); Signature 1909 (6,953 tri); Skyloft Austin (6,016 tri); Solar-roof hall (63e601e8) (2,042 tri); Stone hall with dormer gables (297fcc8d) (1,236 tri); Stone hall with loggia (768ae01e) (4,785 tri); The Diplomat (2,154 tri); The Venue on Guadalupe (3,631 tri); Torre Student Living (6,744 tri); West Campus block 73d1d197 (3,084 tri); West Campus brick bar 8d78646f (3,352 tri); White block on stilts (5b56cd35) (7,064 tri); Yugo Austin Waterloo (4,200 tri).

## All other builds

| Building | Model | Method | Date | Camera | Source | Triangles | Minutes / cost | Owner score | Status | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 100 Congress | Opus 5.5 | lean | 2026-10-15 |  | public photo | 28,246 | 62 min, 439k plan tokens |  | superseded | downtown; weak proof (free lens, fit max at limit); outline off up to 18 m, followed photos; podium plain |
| 1836 San Jacinto | Sol 6.1 | lean | 2026-10-13 | proven | public photo | 18,320 | 66 min, $2.92 |  | superseded | Sol build; owner ordered an Opus redo (started 2026-10-14, not finished when this row was written); glass flat grey |
| 21 Pearl West Campus | Sol 6.1 | lean | 2026-10-13 |  | public photo |  | 3 min, $0.22 |  | failed | stopped by the lead after 3 min (decorated, so Opus); no build yet |
| 21 Rio | Opus 5.5 | trial | 2026-10-13 | loose | public photo | 16,225 | 50 min, 423k plan tokens | "build A clears in every other dimension" | superseded | blind A/B vs Sonnet: owner picked Opus; scale and plan good to about 10%; glazed bay on the wrong face |
| 21 Rio | Sonnet 5.5 | trial | 2026-10-13 | loose | public photo | 12,102 | 69 min, 571k plan tokens | "Rio Mart was done pretty poorly by both" | trial | owner picked Opus over it; walls darker than photograph; scale 1.44x |
| 26 West | Astra 6 | trial | 2026-10-12 |  | site photographs |  | 45 min, $14.19 | 7.5 | trial | run ended exit 1 after 45 min and cost $14; picture still scored |
| 26 West | Sol 6.1 | trial | 2026-10-12 |  | site photographs | 452,172 | 78 min, $4.13 | 8.2-8.3 | trial | file about 6x the Opus triangles, scored below Opus |
| 2819 Rio Grande | Sol 6.1 | trial | 2026-10-12 | proven | site photographs | 26,802 | 83 min, $4.66 | "Opus is better" | trial | owner preferred Opus; Sol got no number |
| Austin by Ellsworth Kelly | Opus 5.5 | lean | 2026-10-15 |  |  | 7,915 | 46 min, 385k plan tokens |  | superseded | proven; coloured glass washed out by the standard glass |
| Austin Proper | Opus 5.5 | lean | 2026-10-15 |  | public photo | 30,982 | 55 min, 396k plan tokens |  | failed | downtown lane; camera fit passed but the build does not match the photo (terraces, podium); main photo blocked by a bridge arch and wires, a 2x crop; height 18% off; not sent |
| Block 185 | Opus 5.5 | lean | 2026-10-15 |  | mixed | 32,051 | 49 min, 394k plan tokens |  | failed | downtown lane; camera not proven (12-19 px); straightened photo, started before fb_shift existed; outline 57 m vs photo 93 m; not sent; retry with fb_shift |
| Block 185 | Opus 5.5 | redo | 2026-10-15 |  | mixed | 32,983 | 50 min, 267k plan tokens |  | failed | retry: camera still not proven (33.5/16.4/7.6 px); plan 3.4x too big through a wrong depth; parked: only 2 photos |
| Block on Pearl north (064e7194) | Opus 5.5 | lean | 2026-10-16 | unproven | Earth 3D | 17,297 | 42 min, 416k plan tokens |  | failed | parked, not sent: very noisy 16-sample draft, mansards and blue walls far too dark, massing reads heavier than Earth; same complex as the parked Pearl south |
| Brown Building | Opus 5.5 | lean | 2026-10-15 |  | Street View | 17,514 | 51 min, 390k plan tokens |  | failed | camera not proven: misses along the east face far end (17-21 px); east face length from OSM likely off; retry after Street View captures |
| Cambridge Tower | Opus 5.5 | first batch | 2026-10-12 |  | site photographs | 20,636 | 50 min |  | superseded | no score given; second final render added after a picture/model mismatch |
| Dewitt C. Greer State Highway Building | Opus 5.5 | lean | 2026-10-15 |  | mixed | 25,244 | 51 min, 437k plan tokens |  | failed | camera not proven (3 of 6 held-out over 8 px, one own bad pick); scale on a traced outline 15% off the photo; not sent |
| Dorothy Gebauer Building | Opus 5.5 | lean | 2026-10-15 |  | public photo |  | 26 min, 336k plan tokens |  | failed | three early stops (oaks; floating camera; scale free with one panorama position); PARKED; parapet ~3 m over the roof deck |
| Driskill Hotel | Opus 5.5 | lean | 2026-10-15 |  | public photo | 35,655 | 62 min, 448k plan tokens |  | failed | 3 of 4 held-out pass; 4th on a traced OSM corner 3-4 m off (128 px); retry as a model fix started |
| Driskill Hotel | Opus 5.5 | redo | 2026-10-15 |  | public photo | 35,211 | 15 min, 200k plan tokens |  | trial | corner fix: held-out 127.9 -> 8.6 px (0.6 over); colour gate passes; no carving; sent as a rough version |
| Ernest O. Thompson State Office Building | Opus 5.5 | lean | 2026-10-15 |  | public photo | 17,944 | 49 min, 365k plan tokens |  | superseded | Capitol lane; early-stop package that proved; marble flat |
| Frost Bank Tower | Opus 5.5 | lean | 2026-10-15 |  | mixed | 35,216 | 46 min, 345k plan tokens |  | failed | downtown lane; camera not proven (held-out 10-22 px); telephoto crown photo with no lens; hidden faces by symmetry, refuted; not sent |
| Frost Bank Tower | Opus 5.5 | redo | 2026-10-15 |  | mixed | 36,520 | 49 min, 463k plan tokens |  | failed | retry on EXIF main: held-out 6.5-21.6 px; both photos from the south-east; 9% too large; PARKED (2 fails) |
| Frost Bank Tower | Opus 5.5 | redo | 2026-10-15 |  | Street View | 34,780 | 75 min |  | failed | try 3 with Street View north/west: wide frames (~116 deg) matched only at sky corners; held-out up to 206 px; PARKED (3 tries) |
| George H. W. Bush State Office Building | Opus 5.5 | lean | 2026-10-13 |  | mixed | 14,246 | 51 min |  | failed | stopped by the owner (about 51 min in); partial files only, no hand-back |
| George I. Sanchez Building | Haiku 5.5 | trial | 2026-10-13 | unproven | mixed | 1,538 | 29 min, 337k plan tokens |  | trial | ranked last; camera unproven, height 20% over the scan; final render refused |
| George I. Sanchez Building | Sonnet 5.5 | trial | 2026-10-13 | unproven | mixed | 4,964 | 44 min, 403k plan tokens |  | trial | ranked second by the owner (blind guess); raised the camera limit itself |
| Graduate School of Business | Opus 5.5 | lean | 2026-10-13 |  | site photographs | 4,025 | 52 min, 437k plan tokens |  | trial | B of the A/B test; glass painted flat, fresh reviewer wanted a second round |
| Harry Ransom Center | Opus 5.5 | lean | 2026-10-13 |  | public photo | 11,962 | 21 min |  | failed | stopped by the owner (about 21 min in); model file only, no render |
| Heinsohn Hall | Opus 5.5 | lean | 2026-10-15 |  | public photo | 13,758 | 57 min, 489k plan tokens |  | failed | camera not proven (held-out 1.5 / 20.5 px, 8 px of it own pick); one photo only; not sent |
| Heinsohn Hall | Opus 5.5 | redo | 2026-10-15 |  | public photo | 13,710 | 27 min, 276k plan tokens |  | failed | independent retry: held-out pass but all on one flat face; camera height 0.44 m (implausible); porthole wall 1.5x tall; not sent; PARKED (2 tries) |
| Indeed Tower | Opus 5.5 | lean | 2026-10-16 | unproven | Earth 3D | 31,187 | 42 min, 398k plan tokens |  | superseded | no score yet; Earth 3D only; held-out 3 of 5 (OSM outline 4-5.5 m off); draft 800 px; glass too blue/flat (rig mirror) |
| John H. Reagan State Office Building | Opus 5.5 | lean | 2026-10-15 |  | public photo | 14,066 | 40 min, 395k plan tokens |  | superseded | Capitol lane; strong; glass grey |
| Kappa Delta house | Haiku 5.5 | trial | 2026-10-13 | unproven | mixed | 2,288 | 27 min, 321k plan tokens |  | superseded | Haiku alone: camera unproven, grainy 800 px render, stopped early; thumbs down |
| McCombs School of Business | Opus 5.5 | lean | 2026-10-13 |  | site photographs | 24,153 | 54 min, 447k plan tokens |  | trial | B of the A/B test (toolkit + short rules); no cheaper than A |
| Neural Molecular Science Building | Opus 5.5 | lean | 2026-10-13 |  | mixed |  | 45 min |  | failed | stopped by the owner (about 45 min in); partial files only, no hand-back |
| Norwood Tower | Opus 5.5 | lean | 2026-10-15 |  | public photo | 27,050 | 53 min, 390k plan tokens |  | superseded | downtown; early-stop package that proved; glass grey; ornament schematic |
| Nursing School | Opus 5.5 | lean | 2026-10-15 |  | public photo | 12,494 | 43 min, 355k plan tokens |  | superseded | no score yet; slots grey not black; gated PASS first |
| Pi Beta Phi house | Haiku 5.5 | trial | 2026-10-13 | proven | public photo | 1,172 | 40 min, 527k plan tokens |  | superseded | Haiku alone: flat columns, no porch depth; used more tokens than an Opus build; thumbs down |
| Powers Student Activity Center | Opus 5.5 | fix round | 2026-10-15 |  | public photo | 32,768 | 51 min, 516k plan tokens |  | trial | WCP round 3: still 4 of 36 photos proven (south only); 27 photos show no measured point; waits for photo-to-photo matching; not sent |
| Powers Student Activity Center | Opus 5.5 | fix round | 2026-10-15 |  | public photo | 32,996 | 47 min, 363k plan tokens |  | trial | WCP round 4: roof and north side from Earth views (unproven); still only south proven; turnaround sent for his read |
| Price Daniel Sr. State Office Building | Opus 5.5 | lean | 2026-10-15 |  | public photo | 16,479 | 43 min, 399k plan tokens |  | superseded | other buildings; no score yet; glass grey |
| Sam Houston State Office Building | Opus 5.5 | lean | 2026-10-15 |  | public photo | 17,555 | 52 min, 452k plan tokens |  | failed | camera not proven: 4 of 6 held-out pass, 2 bad own picks (tree, antenna mast) kept locked; work render only; not sent |
| Seaholm Residences | Opus 5.5 | lean | 2026-10-15 |  | mixed | 29,280 | 56 min, 445k plan tokens |  | failed | downtown lane; camera not proven (a held-out pick on the wrong corner, 49.8 px, kept per 9t); render 2x dark; not sent |
| Seaholm Residences | Opus 5.5 | redo | 2026-10-15 |  | mixed | 29,280 | 40 min |  | failed | independent retry: window grid fits, roof parts 2-4 m high and podium cap 22.7 vs 26.5 m in the model; PARKED (2 fails) |
| Texan Pearl | Sol 6.1 | lean | 2026-10-13 | proven | public photo | 15,674 | 70 min, $3.10 |  | superseded | overlapping, mis-spaced slanted roofs |
| Texas Alpha Phi house | Haiku 5.5 | trial | 2026-10-13 | proven | public photo | 9,868 | 45 min, 467k plan tokens |  | superseded | Haiku alone: iron lace is loose rings; shade patches miss 84-89% |
| Texas Cowboys Pavilion | Opus 5.5 | lean | 2026-10-15 |  | public photo | 12,004 | 58 min, 440k plan tokens |  | failed | main camera not proven (11 px held-out, shift-corrected photo); parts right, framing off; not sent |
| The Block on Pearl (south) | Opus 5.5 | lean | 2026-10-16 | unproven | Earth 3D | 23,455 | 46 min, 428k plan tokens |  | failed | parked: Earth 3D only; held-out fails (one pick on the wrong edge); massing reads wrong next to Earth; 800 px draft only; not sent |
| The Monarch | Opus 5.5 | lean | 2026-10-15 |  | mixed | 32,762 | 59 min, 368k plan tokens |  | failed | downtown; camera not proven (fit 23-26 px, fin checks 17/44 px); main is a crop (lens 3,300 vs EXIF 1,480); not sent |
| The Nine at West Campus | Sol 6.1 | lean | 2026-10-13 | proven | public photo | 14,966 | 71 min, $3.15 |  | superseded | owner: decorated buildings are too hard for Sol; windows read as closed blinds, orange flat |
| The Quarters Grayson House | Sol 6.1 | lean | 2026-10-13 |  | public photo |  | 14 min, $0.57 |  | failed | stopped by the lead after 14 min (decorated, so Opus); no build yet |
| The Texan Shoal Creek | Sol 6.1 | lean | 2026-10-13 | proven | public photo | 15,461 | 65 min, $3.15 |  | superseded | close match; flat left tower wall |
| Turtle Pond and Memorial Garden | Opus 5.5 | lean | 2026-10-15 |  | public photo | 14,776 | 49 min, 401k plan tokens |  | failed | first ground piece; camera not proven (12.7/19.6 px); close-up photo, wrong scale for the city; not sent |
| Twenty Two 15 | Opus 5.5 | trial | 2026-10-16 | unproven | mixed | 14,113 | 35 min, 402k plan tokens |  | trial | trial redo from his rooftop photo 070 (069 is the neighbour north, not this building); camera unproven (outline corners used as held-out: builder's mistake); roof and colours better; court too dark |
| University Avenue Church of Christ | Haiku 5.5 | trial | 2026-10-13 | unproven | site photographs | 977 | 36 min, 443k plan tokens | <6 | superseded | Haiku alone: stone box, camera unproven |
| University Christian Church | Opus 5.5 | lean | 2026-10-15 |  | public photo | 19,966 | 60 min, 461k plan tokens |  | failed | camera not proven (held-out 164-375 px); heights 0.8 of scan, gable front 10.3 m vs survey 6 m; tower crown wrong; not sent |
| University Christian Church | Opus 5.5 | redo | 2026-10-15 |  | public photo | 20,646 | 45 min, 533k plan tokens |  | failed | retries 2+3: outline misread fixed, heights within 1% of scan, crown right; camera still not proven (54/54 px, likely a pavement drop); parked after 3 tries |
| Villas on Nueces | Haiku 5.5 | trial | 2026-10-13 | unproven | mixed | 2,490 | 27 min, 315k plan tokens | "A is really horrible haiku" | trial | owner: horrible; does not register to the photograph |
| Villas on Nueces | Sonnet 5.5 | trial | 2026-10-13 | proven | mixed | 2,698 | 57 min, 468k plan tokens | "B is sonnet it's somewhat alright" | trial | owner: somewhat alright; roof 28% over the scan |
| Walter Webb Hall | Sol 6.1 | lean | 2026-10-14 | proven | public photo | 13,610 | 72 min, $2.80 |  | superseded | glass too light; name sign clipped at the wall edge |
| West Campus block 73d1d197 | Sol 6.1 | lean | 2026-10-17 | loose | Earth 3D | 3,200 | 41 min, $1.86 |  | superseded | Sol on an Earth 3D package (sol_earth_task.py); red east block outside outline omitted; camera roof corners loose |
| West Campus block a06cb507 | Sol 6.1 | lean | 2026-10-17 | loose | Earth 3D | 3,148 | 66 min, $2.00 |  | trial | Sol on a weak Earth package (34% of frame, oaks); angle off; roofs rough; blue pads |
| William P. Clements Jr. State Office Building | Opus 5.5 | lean | 2026-10-15 |  |  | 20,748 | 50 min, 420k plan tokens |  | superseded | other buildings; gate done by the builder; glass light; hidden faces inferred |
| Yugo Austin Waterloo | Haiku 5.5 | trial | 2026-10-12 |  | mixed | 7,388 | 17 min | 4 | trial | weakest of three; stopped early |
| Yugo Austin Waterloo | Sonnet 5.5 | trial | 2026-10-12 |  | mixed | 6,428 | 68 min | 6.5 | trial | weaker than Opus on the same brief |
| Yugo Austin Waterloo | Astra 6 | trial | 2026-10-12 |  | mixed |  | 5 min, $2.16 |  | failed | run killed after 5 min, no build |
| Yugo Austin Waterloo | Sol 6.1 | trial | 2026-10-12 |  | mixed |  | 5 min, $0.31 |  | failed | run killed after 5 min, no build |
| Yugo The Corner | Opus 5.5 | lean | 2026-10-13 |  | site photographs | 6,920 | 53 min, 447k plan tokens |  | trial | B of the A/B test; builder saw A's sheet once (flaw in the test) |

_Kept by `ledger_add.py` from the private build record; one row is added at every hand-back._
