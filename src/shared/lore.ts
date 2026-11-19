// Histoire du monde (phase 9) : documents trouvés dans les lieux abandonnés, clés, lieux évoqués.
// Histoire originale, non linéaire : le joueur la reconstitue et l'interprète librement, sans quête imposée.
//
// Ce qu'on peut comprendre en lisant tout (rien n'est jamais affirmé d'un bloc) :
// - Quelques mois avant « le Silence », des signes : bétail qui refuse de boire, eau des bassins qui monte et
//   descend la nuit, oiseaux qui se taisent, lumières près des Pierres Debout, boussoles affolées.
// - La station du lac (Dr Nyasha Chikore, son assistant Farai) suit au sonar un écho immense qui se
//   déplace la nuit, du fond du lac vers le fleuve, et semble chasser au bruit.
// - La mine de la Colline Rouge a percé une cavité naturelle (galerie 7) : air chaud, coups sous les pieds.
// - Le père Matthieu, à la mission, a recueilli auprès des anciens la légende de « Celui-qui-dort-sous-l'eau »,
//   gardien du fleuve, que l'on laisse dormir et que les cercles de pierres tiennent endormi.
// - Une étudiante a relevé, dans l'enceinte de pierre sèche, les mêmes gravures que les peintures des abris
//   des collines de granit : une longue créature aux yeux nombreux, entourée de cercles.
// - La nuit du 8 au 9, tout le monde a entendu un long souffle. Le 9, il n'y avait plus personne.

import type { PlaceKind } from './places';

export type DocKind = 'lettre' | 'journal' | 'carnet' | 'releve' | 'note' | 'registre' | 'telegramme';

export interface LoreDoc {
  id: string;
  title: string;
  kind: DocKind;
  /** Où on le trouve (genre de lieu). */
  place: PlaceKind;
  /** Paragraphes. */
  text: string[];
  /** Lieux que le document évoque (une note approximative s'ajoute à la carte). */
  mentions?: PlaceKind[];
}

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  lettre: 'Lettre',
  journal: 'Journal',
  carnet: 'Carnet',
  releve: 'Relevé',
  note: 'Note',
  registre: 'Registre',
  telegramme: 'Télégramme',
};

const docs: LoreDoc[] = [
  // ——— Fermes ———
  {
    id: 'f_lettre_rudo1',
    title: 'Lettre de Rudo à sa sœur',
    kind: 'lettre',
    place: 'ferme',
    mentions: ['mission'],
    text: [
      'Chère Chipo,',
      'Les vaches ne veulent plus boire à la rivière. Tendai les mène jusqu’au bord et elles reculent, toutes ensemble, comme devant un feu. Hier il a trouvé un veau couché près de l’eau. Pas une blessure. Il était léger comme une calebasse vide.',
      'Le père Matthieu est passé à la ferme. Il dit de garder les enfants loin de l’eau la nuit, et il ne riait pas. Tatenda dessine des serpents partout dans son cahier.',
      'Embrasse les petits. Ta sœur, Rudo.',
    ],
  },
  {
    id: 'f_lettre_rudo2',
    title: 'Seconde lettre de Rudo',
    kind: 'lettre',
    place: 'ferme',
    mentions: ['mission', 'station'],
    text: [
      'Chipo,',
      'Le père Matthieu est parti pour la station du lac, voir la docteure Chikore. Avant de partir, il m’a confié la clé de la sacristie : « Si je ne reviens pas avant les pluies, ce qui est enfermé là-bas ne doit pas rester sans gardien. » Je l’ai rangée dans la caisse, sous les draps.',
      'La nuit, l’eau du bassin descend, puis remonte. Doucement. Comme une poitrine.',
      'Rudo.',
    ],
  },
  {
    id: 'f_cahier_tatenda',
    title: 'Cahier d’école de Tatenda',
    kind: 'carnet',
    place: 'ferme',
    text: [
      'Dessin : un grand serpent dans le lac, avec des yeux tout le long du corps. En dessous, d’une écriture appliquée : « Le gardien. Grand-mère dit qu’il dort. »',
      'Dessin : des pierres debout en rond, et des petites lumières entre elles.',
      '« Papa dit que ce sont des histoires. Mais papa ne va plus chercher l’eau tout seul. »',
    ],
  },
  {
    id: 'f_journal_sibanda',
    title: 'Almanach de M. Sibanda',
    kind: 'journal',
    place: 'ferme',
    mentions: ['gare'],
    text: [
      'Le 2 : 14 mm de pluie. Le maïs lève bien.',
      'Le 5 : le chien ne veut plus dormir dehors. Il gratte la porte jusqu’au matin.',
      'Le 7 : plus un oiseau depuis midi. Silence complet. Même les grenouilles.',
      'Le 8 : le chien hurle vers le nord, vers le fleuve. Demain je descends à la halte pour le train de six heures. Nous partons tous.',
    ],
  },
  {
    id: 'f_note_porte',
    title: 'Note clouée à la porte',
    kind: 'note',
    place: 'ferme',
    mentions: ['mission'],
    text: ['Si vous lisez ceci : ne restez pas près de l’eau la nuit. Ne faites pas de bruit près de la rivière. Nous sommes partis vers la mission. — Famille Ncube'],
  },
  // ——— Mission ———
  {
    id: 'm_journal_pere',
    title: 'Journal du père Matthieu',
    kind: 'journal',
    place: 'mission',
    mentions: ['mine', 'ruines', 'cercle'],
    text: [
      'Les anciens de la rive parlent de Celui-qui-dort-sous-l’eau. Il garde le fleuve. Il dort dans les eaux profondes, et tant qu’il dort, le fleuve donne le poisson, la pluie revient, les enfants grandissent.',
      'On ne le chasse pas. On ne le nomme pas à voix haute. On le laisse dormir. Quand les hommes prennent trop à la terre, il se réveille, et il marche sous le sol, dans les veines de la roche, jusqu’à ce qu’il trouve ce qui l’a réveillé.',
      'Ambuya Tsitsi dit que les pierres debout, au sud, ont été dressées pour le bercer. Que les gens de l’enceinte de pierre le savaient.',
      'J’ai écrit à la direction de la mine de la Colline Rouge. Ils ont percé quelque chose, là-dessous. Ils ne m’ont pas répondu.',
      'Dernière page, écriture rapide : « Le souffle, cette nuit. Toute la vallée l’a entendu. Je descends au lac. Que Dieu me pardonne d’avoir douté d’elle. »',
    ],
  },
  {
    id: 'm_registre',
    title: 'Registre de la mission',
    kind: 'registre',
    place: 'mission',
    text: [
      'Visites, baptêmes, malades. Une écriture régulière, des pages entières de noms.',
      'Les dernières semaines, la colonne « malades » se remplit : « fièvre, cauchemars », « ne dort plus », « entend l’eau ».',
      'Le 9 : « Personne à la messe. » La ligne suivante est vide.',
    ],
  },
  {
    id: 'm_lettre_eveque',
    title: 'Lettre à Monseigneur (brouillon)',
    kind: 'lettre',
    place: 'mission',
    text: [
      'Monseigneur,',
      'Vous m’aviez demandé de me défaire du fusil du vieux M. Hall. Je ne l’ai pas fait. Je l’ai enfermé dans la sacristie, avec ses cartouches, et je garde la clé sur moi. Ce n’est pas pour les hommes.',
      'Les gens d’ici ont peur, et je commence à croire qu’ils ont raison d’avoir peur.',
      'Votre serviteur, Matthieu.',
    ],
  },
  {
    id: 'm_conte',
    title: 'Le conte d’Ambuya Tsitsi',
    kind: 'note',
    place: 'mission',
    mentions: ['cercle'],
    text: [
      'Recopié par le père Matthieu, tel qu’on le lui a raconté au coin du feu :',
      '« Au commencement, le fleuve avait faim. Alors le gardien s’est couché au fond de l’eau, et il a avalé la faim du fleuve. Depuis, il dort. Ses yeux sont tout le long de son corps, et il voit avec ses oreilles. Quand il rêve, l’eau monte et descend. Nos pères ont dressé les pierres en rond pour chanter avec lui, pour qu’il ne s’éveille pas. Si un jour les pierres se taisent, il n’y aura plus personne pour chanter. »',
    ],
  },
  // ——— Halte ferroviaire ———
  {
    id: 'g_registre',
    title: 'Registre de la halte',
    kind: 'registre',
    place: 'gare',
    mentions: ['station', 'cercle'],
    text: [
      'Halte de Nyangombe. Chef de halte : J. Dube.',
      'Caisse n° 12 pour la station du lac, à l’attention du Dr Chikore : « hydrophones, fragile ». Avec une clé de rechange du laboratoire, à remettre en main propre. En attente, rangée au bureau.',
      'Le 8 : train de 18 h arrivé avec trois heures de retard. Le conducteur dit avoir vu des lumières sur la plaine, du côté des Pierres Debout, qui se déplaçaient au ras du sol.',
      'Le 9 : pas de train. Le télégraphe ne répond plus. Les familles attendent sur le quai depuis l’aube.',
    ],
  },
  {
    id: 'g_telegramme',
    title: 'Télégramme pour la station',
    kind: 'telegramme',
    place: 'gare',
    mentions: ['station'],
    text: ['DE STATION LAC A DIRECTION — ECHO GEANT SOUS LE LAC STOP IL SE DEPLACE LA NUIT VERS LE FLEUVE STOP IL REAGIT AU BRUIT STOP ENVOYEZ HYDROPHONES URGENT STOP CHIKORE'],
  },
  // ——— Station de recherche du lac ———
  {
    id: 's_carnet_bord',
    title: 'Carnet de bord du Dr Chikore',
    kind: 'carnet',
    place: 'station',
    mentions: ['mine'],
    text: [
      'Écho de 40 m de long à 60 m de fond. Ce n’est pas un banc de poissons : il est d’un seul tenant, et il bouge.',
      'Il remonte la nuit, toujours vers l’embouchure. Le jour, il redescend. La température de l’eau du fond a pris deux degrés en un mois. Les poissons meurent en surface.',
      'Il réagit au bruit. Dès que le moteur du bateau tourne, l’écho se tourne vers nous. Désormais nous coupons le moteur et nous ramons.',
      'Sa route suit une faille qui part du lac et file sous la Colline Rouge. Exactement là où la mine creuse.',
      'Dernière entrée : « Farai est descendu au ponton à deux heures. Je l’entends encore appeler. Ou je crois l’entendre. »',
    ],
  },
  {
    id: 's_releve_sonar',
    title: 'Relevés du sonar',
    kind: 'releve',
    place: 'station',
    text: [
      'Nuit 1 : écho à 62 m, immobile.',
      'Nuit 4 : 55 m, déplacement de 300 m vers le nord-est.',
      'Nuit 9 : 41 m. Vitesse estimée : celle d’un homme qui marche.',
      'Nuit 12 : 18 m. Sous le ponton. Rien d’autre sur l’écran.',
      'Nuit 13 : pas de relevé.',
    ],
  },
  {
    id: 's_lettre_farai',
    title: 'Lettre de Farai à sa mère',
    kind: 'lettre',
    place: 'station',
    mentions: ['mine'],
    text: [
      'Maman,',
      'Au début c’était la plus belle chose de ma vie : une découverte, une vraie, et j’en fais partie. Maintenant je n’aime plus regarder l’écran.',
      'Les pêcheurs de la rive disent qu’il ne faut pas le réveiller. Que la mine a creusé trop profond, sous la Colline Rouge, et que depuis il cherche. La docteure dit que c’est une faille, et du gaz. Elle ne dort plus non plus.',
      'Je rentre dès que la caisse de la halte sera arrivée. Ton fils, Farai.',
    ],
  },
  // ——— Mine de la Colline Rouge ———
  {
    id: 'mi_rapport',
    title: 'Rapports du contremaître Banda',
    kind: 'registre',
    place: 'mine',
    mentions: ['station'],
    text: [
      'Galerie 7, 112 m : percé dans une cavité naturelle. Air chaud, odeur de vase. Les lampes vacillent comme si l’air respirait.',
      'Deux hommes disent avoir entendu frapper sous leurs pieds. Trois coups, puis trois coups.',
      'La direction exige qu’on continue : il y a de l’or dans la cavité. Les hommes refusent de descendre la nuit.',
      'Le 8 : le puits respire. Il aspire, il souffle. J’ai fermé la réserve et je garde la clé dans le bureau. Personne ne descend demain.',
    ],
  },
  {
    id: 'mi_note_mineur',
    title: 'Mots griffonnés',
    kind: 'note',
    place: 'mine',
    text: ['IL NE VOIT PAS. IL ENTEND. NE COURS PAS. NE CRIE PAS. ÉTEINS LA LAMPE ET ATTENDS.'],
  },
  // ——— Enceinte de pierre sèche ———
  {
    id: 'r_carnet_simba',
    title: 'Carnet de fouilles de Simba',
    kind: 'carnet',
    place: 'ruines',
    mentions: ['cercle'],
    text: [
      'Enceinte de pierre sèche, sans mortier, d’une régularité étonnante. La tour est pleine : ce n’est pas un grenier.',
      'Sur une pierre du mur, côté est : une gravure. Une longue créature, des yeux tout le long du corps, entourée de cercles concentriques.',
      'Les mêmes motifs que les peintures des abris, dans les collines de granit. Les mêmes yeux.',
      'Selon la tradition orale, les cercles « le tiennent endormi ». J’ai mesuré : la tour, l’enceinte et les Pierres Debout sont alignées sur le fleuve.',
    ],
  },
  // ——— Cercle de pierres ———
  {
    id: 'c_releve_geometre',
    title: 'Relevé du géomètre',
    kind: 'releve',
    place: 'cercle',
    text: [
      'Le 7. Déviation de la boussole à l’intérieur du cercle : 40 degrés, variable. Hors du cercle : normale.',
      'Vibration du sol perceptible à la main, la nuit seulement, par cycles réguliers.',
      'Lumières basses entre les pierres vers 2 h. Pas de source visible. Dans la brume, un son grave, très long, comme une respiration.',
      'Je n’ai pas terminé le relevé.',
    ],
  },
];

export const DOCS: Record<string, LoreDoc> = Object.fromEntries(docs.map((d) => [d.id, d]));
export const DOC_IDS = docs.map((d) => d.id);

/** Clés : ce qu'elles ouvrent (étiquette affichée, lieu). */
export const KEYS: Record<string, { label: string; opens: PlaceKind }> = {
  sacristie: { label: 'de la sacristie', opens: 'mission' },
  labo: { label: 'du laboratoire', opens: 'station' },
  reserve: { label: 'de la réserve', opens: 'mine' },
};

export function isDocId(v: unknown): v is string {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DOCS, v);
}

/** Nom affiché d'un document ou d'une clé (« Lettre de Rudo à sa sœur », « clé de la sacristie »). */
export function taggedName(item: string, tag: string | undefined): string | null {
  if (!tag) return null;
  if (item === 'document') return DOCS[tag]?.title ?? null;
  if (item === 'cle') return KEYS[tag] ? `clé ${KEYS[tag]!.label}` : null;
  return null;
}
