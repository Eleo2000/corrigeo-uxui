# Corrigeo — Résumé produit complet (brief UX/UI + analyse)

## 1. Ce que c'est

**Corrigeo** = assistant de relecture de documents Word `.docx` en français, pensé
pour les mémoires et thèses universitaires (documents longs, 50–150 pages,
enjeu de crédibilité académique).

**Promesse** : *Corrigeo propose, l'utilisateur décide.* Aucune réécriture
automatique — chaque erreur détectée devient une proposition traçable que
l'étudiant accepte ou refuse. Le fichier exporté ne contient que le texte
d'origine + les remplacements choisis.

**Modèle de déploiement** : application locale (desktop) — le document ne
quitte jamais la machine de l'utilisateur. Moteur de détection = LanguageTool
local (Java). Option prévue : analyse contextuelle via GPT (opt-in).

## 2. Utilisateurs et contexte

- Étudiant·e·s rédigeant un mémoire/thèse en français
- Peu ou pas techniques — l'outil doit être rassurant, pas intimidant
- Peur légitime : *« l'outil va casser mon document / changer mon texte
  sans que je le voie »* → la confiance est la métrique n°1
- Usage ponctuel mais intense : corriger 100–300 propositions d'un coup,
  sans fatigue ni erreur de décision

## 3. Architecture actuelle

```
corrigeo_app_server (Flask, python-docx, LanguageTool local)
  POST /api/documents            upload .docx (25 Mo max, validation réelle)
  GET  /api/documents/<id>/proposals   liste des propositions
  POST /api/documents/<id>/decisions   décisions {id: chosen|kept|pending}
  GET  /api/documents/<id>/summary     récapitulatif
  POST /api/documents/<id>/export      applique les "chosen" → nouveau .docx
  GET  /api/documents/<id>/download    téléchargement

corrigeo-uxui (front statique, HTML/CSS/JS vanilla — SPA 4 écrans)
  documents → upload (mode guidé | automatique) → relecture → résultat
```

**Pipeline fiable déjà en place** : extraction par paragraphes (runs +
tableaux) → propositions avec ancre `text[start:end] == original` → décisions
→ export qui repart du fichier original et vérifie chaque ancre avant
d'écrire. Runs protégés (images, champs, liens) refusés. Pas de
chevauchement. Formatage préservé (on n'écrit que dans `run.text`).

## 4. Parcours UX actuel (implémenté)

1. **Documents** : stats (à vérifier / acceptées / conservées) + ligne du
   document en cours avec progression
2. **Upload** : dropzone + choix du mode —
   *Relecture guidée* (défaut) ou *Correction automatique* (tout accepter)
3. **Relecture** : une proposition à la fois —
   catégorie + titre (« fuate → faute »), extrait original / suggestion en
   deux blocs (espaces rendus visibles ␣⍽⇥), explication LanguageTool,
   boutons « Garder mon texte » / « Accepter ».
   Filtres latéraux par statut et catégorie, action groupée par vue,
   raccourcis `A`/`G`/`Z`/flèches, progression acceptées/conservées/restantes.
4. **Résultat** : compteurs appliquées / non retenues / non applicables,
   téléchargement .docx + récapitulatif CSV.

## 5. Points forts actuels

- **Fiabilité éprouvée** : 40 tests, ancres validées, échec = rejet local
  (jamais de corruption silencieuse — mesuré : 2 propositions rejetées sur
  23 sur un vrai document)
- **Réversibilité totale** : l'original n'est jamais touché ; décisions
  modifiables + ré-export déterministe
- **Pédagogique** : chaque proposition est expliquée, pas juste appliquée
- **Performance** : relecture clavier rapide, une décision = un POST

## 6. Points faibles UX identifiés

- **Décontextualisation visuelle** : on voit l'extrait mais pas le document —
  l'utilisateur ne sait pas *où* se situe l'erreur dans son mémoire
- **Pas de pagination** : docx = flux, pas de pages stockées
  (contournable via `w:lastRenderedPageBreak`, présent dans les vrais docs
  Word — essai1.docx : 111 marqueurs)
- **Une proposition à la fois** peut devenir long sur 200+ erreurs mécaniques
  (espaces doubles, tirets) — la vue groupe/filtre aide mais ne montre pas
  le contexte document
- **Pas d'aperçu du résultat final** avant téléchargement
- **Pas de sauvegarde de session** (mémoire, TTL 4 h) — reprendre plus tard
  impossible
- **Propositions verbales de LanguageTool parfois obscures** pour un
  étudiant (« Morphological error » etc.)

## 7. Options analysées (pas encore implémentées)

| Option | Description | Verdict |
|---|---|---|
| **docx-preview.js** | Rendre le .docx dans la page, erreurs surlignées, clic→scroll | **Priorité 1** — résout la décontextualisation, medium cost, zéro risque backend |
| **Révisions Word (`w:ins`/`w:del`)** | Export avec suivi des modifications natif | Priorité 2 — re-vérification native dans Word, ~150 lignes lxml |
| **Numéros de page** | `lastRenderedPageBreak` → « Page ~N » dans les labels | Cheap (~30 lignes), approximatif, à afficher comme tel |
| **Moteur GPT opt-in** | `gpt-4.1-mini` pour contexte/style/homophones | Réelle valeur (ce que LT ne voit pas), mais : opt-in (privacy), nouvelle clé, validation stricte des offsets (LLM non fiable → ancre vérifiée) |
| **Grammalecte** | Moteur français pur Python (remplace la JVM) | Intéressant : pas de Java, meilleur sur le français |
| **Add-in Office.js** | Corrigeo dans Word | Hors de portée actuelle (autre stack, distribution) |

## 8. Questions pour l'analyse UX/UI

1. Relecture carte-par-carte vs liste continue vs aperçu-doc-annoté : quel
   équilibre pour ~150 décisions sans fatigue ?
2. Comment rendre visible la *localisation* (page/section) sans fausser la
   confiance (pagination approximative) ?
3. Grouper les erreurs triviales (espaces, tirets) en action en un clic sans
   risquer l'acceptation aveugle ?
4. Faut-il un mode « diff global » (tout le document avec changements en
   place) avant export ?
5. Comment expliquer simplement les règles LanguageTool à un étudiant ?
6. Le mode « correction automatique » : quel garde-fou UX (résumé post-hoc,
   undo, indicateur de confiance par proposition) ?
7. Design : la palette bleue SaaS actuelle est-elle la bonne pour un outil
   académique de confiance ?

## 9. Contraintes à respecter

- Local-first : pas de backend distant, pas d'auth — app desktop
- `.docx` seul, 25 Mo max
- Aucune correction sans décision explicite (sauf mode auto choisi)
- L'original n'est jamais modifié
- Échec moteur/ancre = rejet local silencieux, jamais de texte corrompu
- Front = HTML/CSS/JS vanilla servi par Flask (`CORRIGEO_FRONT_DIR`)
