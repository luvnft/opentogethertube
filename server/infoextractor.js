const URL = require("url");
const DailyMotionAdapter = require("./services/dailymotion");
const GoogleDriveAdapter = require("./services/googledrive");
const VimeoAdapter = require("./services/vimeo");
const YouTubeAdapter = require("./services/youtube");
const DirectVideoAdapter = require("./services/direct");
const storage = require("../storage");
const Video = require("../common/video");
const { UnsupportedMimeTypeException, OutOfQuotaException } = require("./exceptions");
const { getLogger } = require("../logger");

const log = getLogger("infoextract");

const adapters = [
  new DailyMotionAdapter(),
  new GoogleDriveAdapter(),
  new VimeoAdapter(),
  new YouTubeAdapter(process.env.YOUTUBE_API_KEY),
  new DirectVideoAdapter(),
];

function isURL(str) {
  return URL.parse(str).host != null;
}

async function getCachedVideo(service, videoId) {
  try {
    const result = await storage.getVideoInfo(service, videoId);
    const video = new Video(result);
    const missingInfo = storage
      .getVideoInfoFields(video.service)
      .filter(p => !video.hasOwnProperty(p));

    if (video.mime && !this.isSupportedMimeType(video.mime)) {
      throw new UnsupportedMimeTypeException(video.mime);
    }

    return [video, missingInfo];
  }
  catch (e) {
    log.error(`Failed to get video metadata: ${e}`);
    throw e;
  }
}

async function updateCache(videos) {
  if (Array.isArray(videos)) {
    return storage.updateManyVideoInfo(videos);
  }
  else {
    return storage.updateVideoInfo(videos);
  }
}

function getServiceAdapter(service) {
  return adapters.find(adapter => adapter.serviceId === service);
}

function getServiceAdapterForURL(url) {
  return adapters.find(adapter => adapter.canHandleLink(url));
}

async function getVideoInfo(service, videoId) {
  const adapter = getServiceAdapter(service);
  const [cachedVideo, missingInfo] = await getCachedVideo(service, videoId);

  if (missingInfo === 0) {
    return cachedVideo;
  }
  else {
    log.warn(`MISSING INFO for ${cachedVideo.service}:${cachedVideo.id}: ${missingInfo}`);

    try {
      const fetchedVideo = adapter.fetchVideoInfo(cachedVideo.id, missingInfo);
      const video = Video.merge(cachedVideo, fetchedVideo);
      updateCache(video);
      return video;
    }
    catch (e) {
      if (e instanceof OutOfQuotaException) {
        log.error("Failed to get video info: Out of quota");
        if (missingInfo.length < storage.getVideoInfoFields(cachedVideo.service).length) {
          log.warn(`Returning incomplete cached result for ${cachedVideo.service}:${cachedVideo.id}`);
          return cachedVideo;
        }
        else {
          throw e;
        }
      }
      else {
        log.error(`Failed to get video info for ${cachedVideo.service}:${cachedVideo.id}: ${e}`);
        throw e;
      }
    }
  }
}

async function resolveVideoQuery(query, searchService) {
  const results = [];

  if (isURL(query)) {
    const adapter = getServiceAdapterForURL(query);

    if (!adapter.isCollectionURL(query)) {
      return getVideoInfo(
        adapter.serviceId,
        adapter.getVideoId(query)
      );
    }

    const fetchResults = await adapter.resolveURL(query);
    results.push(...fetchResults);
  }
  else {
    const searchResults = await searchVideos(searchService, query);
    results.push(...searchResults);
  }

  updateCache(results);
  return results;
}

function searchVideos(service, query) {
  const adapter = getServiceAdapter(service);
  return adapter.searchVideos(query);
}

module.exports = {
  getServiceAdapter,
  getServiceAdapterForURL,
  getVideoInfo,
  resolveVideoQuery,
  searchVideos,
};
