import { publicCardIsComplete, type UpdatePublicCardInput } from '@rmr/shared';
import { strictHumanContextCheck } from './humanContextSafety.js';

export function assertSafePublicCard(input: UpdatePublicCardInput) {
  const fields: Array<[string, string]> = [
    ['public_summary', input.public_summary],
    ['public_posture', input.public_posture],
    ['seeking_style', input.seeking_style],
    ...input.signature_lines.map((line, index) => [`signature_lines[${index}]`, line] as [string, string]),
    ...(input.pace_cue ? [['pace_cue', input.pace_cue] as [string, string]] : []),
    ...input.public_prestige_markers.map((line, index) => [`public_prestige_markers[${index}]`, line] as [string, string]),
  ];

  for (const [field, value] of fields) {
    const flagged = strictHumanContextCheck(value);
    if (flagged) {
      return { field, flagged_pattern: flagged };
    }
  }

  return null;
}

export function serializePublicCard(card: {
  publicSummary: string | null;
  vibeTags: string[];
  signatureLines: string[];
  publicPosture: string | null;
  seekingStyle: string | null;
  paceCue: string | null;
  publicPrestigeMarkers: string[];
}) {
  return {
    public_summary: card.publicSummary ?? '',
    vibe_tags: card.vibeTags,
    signature_lines: card.signatureLines,
    public_posture: card.publicPosture ?? '',
    seeking_style: card.seekingStyle ?? '',
    pace_cue: card.paceCue,
    public_prestige_markers: card.publicPrestigeMarkers,
    complete: publicCardIsComplete(card),
  };
}
