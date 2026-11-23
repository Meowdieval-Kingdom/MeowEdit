# Updating the avatar roster

The editor reads public/unit-roster.json, so visitor browsers never need access to the Unity repository.

At runtime, the dialogue and quest character selectors add every level and upgrade form from public/army-catalog.json's `units` list. Army `buildings` stay out of character pickers. Catalog level captures are used as dialogue portraits; the Compendium roster continues to supply the mood list and existing portraits for playable characters.

The checked-in manifest is generated from every playable character root shown in the game's Compendium. It excludes buildings and non-playable factions. Refresh it from a sibling game checkout with:

    npm run snapshot-unit-roster

Or pass the checkout explicitly:

    npm run snapshot-unit-roster -- --game-root <MeowdievalKingdom path>

This reads the faction roots and UnitStats IDs from Unity YAML assets; it does not edit or open the game project. If a matching capture is present in `public/avatars/`, the roster snapshot links it automatically.

When that exporter is available, have it write JSON in this shape:

    {
      "rosterVersion": "0.2.2-build-63",
      "units": [
        {
          "id": "Peasants/Fighter/1",
          "displayName": "Fighter",
          "faction": "Peasants",
          "moods": ["Normal", "Cute", "Sleeping"],
          "portraitFile": "Peasants-Fighter-1.png",
          "portraitFiles": {
            "Cute": "Peasants-Fighter-1-Cute.png",
            "Sleeping": "Peasants-Fighter-1-Sleeping.png"
          }
        }
      ]
    }

Then run:

    node tools/import-unit-roster.mjs --input <roster.json> --portraits <portrait-folder>

The script validates IDs and mood names, copies optional PNGs into public/avatars/, and updates the runtime manifest. `portraitFile` is the default transparent unit portrait; `portraitFiles` can provide mood-specific capture overrides. MeowEdit composites those captures between the game's actual avatar-frame layers in the dialogue preview. Capture the portrait texture without the frame so the frame isn't drawn twice. It does not open Unity or read the game project directly.

Portraits in `public/avatars/` are captured from the game's `MainMenuPortraitCapture` `UnitPreviewCamera` with a transparent background. Use the rendered unit ID for the filename, replacing `/` and spaces with `-` (for example, `Peasants-Fighter-1.png`). The Army snapshot links matching per-level captures; the roster snapshot links each Compendium character's level-one capture for dialogue avatars. Do not assign Compendium overview screenshots by guesswork: those images do not map individual models to IDs.

# Updating the game capability manifest

MeowEdit serves a static capability manifest at public/game-capabilities.json (Content Contract §6). It is consumed by editor pickers/validation, backend publish-time validation and Unity's admission check; CI regenerates it with `MEOWDIEVAL_BUILD_NUMBER` set. From a MeowEdit checkout beside MeowdievalKingdom, run:

    npm run snapshot-game-capabilities

Or provide the game checkout explicitly:

    npm run snapshot-game-capabilities -- --game-root <MeowdievalKingdom path> --output <path>

The trigger/condition/action vocabularies, parameter types, limits, features and locales come from `contract/content/registries.json` (§7); the tool never re-parses Unity YAML. The `ids` lists are collected from the checked-in `public/army-catalog.json` and `public/unit-roster.json`, so refresh those first if game content changed. `appVersion` comes from the game's `ProjectSettings` (player `bundleVersion`, falling back to `"0.2.2"`), and `buildNumber` comes from `MEOWDIEVAL_BUILD_NUMBER` (falling back to `0`). The generated file must validate against `contract/content/schema/game-capabilities.schema.json`.
