# Corrigeo — maquette UX/UI

Maquette front-end autonome, en français, pour présenter un parcours de relecture de documents Word.

## Pages

- `index.html` : accueil et sélection visuelle d'un fichier `.docx`.
- `documents.html` : espace des documents (une seule entrée de démonstration pour éviter un faux historique).
- `analyse.html` : présentation des propositions détectées.
- `revision.html` : comparaison de chaque phrase, explication et choix de l'utilisateur.
- `resultat.html` : récapitulatif concret des changements retenus, des phrases conservées et des propositions non vérifiées.

## Lancer la maquette

Décompresser le dossier puis ouvrir `index.html` dans un navigateur récent. Aucun serveur ni dépendance n'est nécessaire.

## Interactions disponibles

- Sélection visuelle d'un fichier `.docx` (le fichier n'est pas envoyé ni analysé).
- Parcours de démonstration avec cinq propositions fictives.
- Choix « Utiliser la correction » ou « Garder ma phrase ».
- Modification des choix après coup.
- Progression mise à jour automatiquement.
- Récapitulatif actualisé selon les décisions.
- Téléchargement d'un récapitulatif texte et impression.
- Sauvegarde temporaire des choix dans `localStorage` du navigateur.

## Limites volontaires

Cette maquette n'est pas reliée à Flask, Socket.IO, LanguageTool, OpenAI ni au traitement réel des fichiers Word. Les phrases et résultats sont fictifs. Aucun `.docx` n'est modifié ou généré. Le parcours montre une direction UX/UI, pas une preuve de fonctionnement du moteur de correction.
