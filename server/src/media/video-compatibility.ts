// A video counts as "needs modernizing" purely by codec - h264/vp8/vp9/av1
// video with aac/mp3/opus/vorbis audio (or no audio track at all) plays
// natively in every current browser regardless of container. Container/
// format isn't part of this check: ffprobe's format_name is shared across
// the whole mov/mp4/m4a/3gp family regardless of what codec is actually
// inside, so it can't tell a modern .mp4 apart from a decades-old MJPEG
// .mov - only the codec names can.
//
// A single SQL fragment (rather than a JS predicate re-implemented per
// query) so the scan-root stats count and the candidates list can never
// drift out of sync with each other. Append with AND to a WHERE clause
// already scoped to `media_type = 'video' AND status = 'active'`.
export const NEEDS_TRANSCODE_SQL_CLAUSE = `
  NOT (
    codec IN ('h264', 'vp8', 'vp9', 'av1')
    AND (audio_codec IS NULL OR audio_codec IN ('aac', 'mp3', 'opus', 'vorbis'))
  )
  AND id NOT IN (SELECT media_id FROM video_transcode_jobs WHERE status = 'archived')
`;
