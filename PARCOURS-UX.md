# Le parcours Corrigeo, en termes simples

## La promesse

Corrigeo ne réécrit pas le mémoire à la place de l'étudiant. Il signale des passages à vérifier, explique une proposition et laisse l'étudiant décider.

## Les trois étapes visibles

1. **Document** — l'étudiant ajoute son fichier.
2. **Vérification** — pour chaque passage, il compare sa phrase et la proposition, puis choisit « Utiliser la correction » ou « Garder ma phrase ».
3. **Récapitulatif** — il voit précisément les changements retenus, les phrases conservées et les propositions auxquelles il n'a pas répondu.

## Règles UX retenues

- Pas de boutons « précédent » / « suivant » : les propositions sont présentées dans une liste continue.
- Pas de jargon technique dans les textes destinés à l'étudiant.
- Deux décisions seulement : utiliser la proposition ou conserver sa phrase. Une proposition laissée sans décision reste simplement « non vérifiée ».
- Une correction n'est jamais présentée comme appliquée avant la préparation du document final.
- Les passages non vérifiés restent inchangés par défaut : l'absence de réponse ne vaut pas accord.
- Le récapitulatif montre les phrases exactes, et pas uniquement des compteurs.
- L'utilisateur peut revenir modifier ses choix.

## Ce qui reste à connecter au vrai produit

Cette maquette ne lit pas le contenu du fichier Word et ne génère pas de `.docx`. Le futur backend devra fournir, pour chaque proposition, le texte original exact, le texte proposé, l'explication, la localisation dans le document et un identifiant stable. À l'export, seules les propositions retenues devront être appliquées, après validation de leur emplacement et du texte original.
