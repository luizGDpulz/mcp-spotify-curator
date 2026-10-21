import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPlaylistId,
  cleanTrackUri,
  normalizeTrackSignature,
} from "../src/spotify.js";

describe("Utility: cleanPlaylistId", () => {
  it("should extract playlist ID from spotify:playlist: URI", () => {
    assert.equal(
      cleanPlaylistId("spotify:playlist:76fQK526wOVx8A3gkHTiHn"),
      "76fQK526wOVx8A3gkHTiHn"
    );
  });

  it("should extract playlist ID from full Spotify web URL", () => {
    assert.equal(
      cleanPlaylistId("https://open.spotify.com/playlist/76fQK526wOVx8A3gkHTiHn?si=abc123xyz"),
      "76fQK526wOVx8A3gkHTiHn"
    );
  });

  it("should trim surrounding whitespace from raw ID", () => {
    assert.equal(cleanPlaylistId("  76fQK526wOVx8A3gkHTiHn  "), "76fQK526wOVx8A3gkHTiHn");
  });
});

describe("Utility: cleanTrackUri", () => {
  it("should preserve standard spotify:track: URI", () => {
    assert.equal(
      cleanTrackUri("spotify:track:4iV5W9uYEdYUVa79Axb7Rh"),
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    );
  });

  it("should preserve standard spotify:episode: URI", () => {
    assert.equal(
      cleanTrackUri("spotify:episode:512OJhC5PbicgZBehLfTMy"),
      "spotify:episode:512OJhC5PbicgZBehLfTMy"
    );
  });

  it("should convert full Spotify track URL to URI", () => {
    assert.equal(
      cleanTrackUri("https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=123"),
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    );
  });

  it("should convert raw track ID to spotify:track: URI", () => {
    assert.equal(cleanTrackUri("4iV5W9uYEdYUVa79Axb7Rh"), "spotify:track:4iV5W9uYEdYUVa79Axb7Rh");
  });
});

describe("Utility: normalizeTrackSignature", () => {
  it("should match original and remastered versions with years at the end", () => {
    const original = normalizeTrackSignature("Bohemian Rhapsody", ["Queen"]);
    const remastered = normalizeTrackSignature("Bohemian Rhapsody - Remastered 2011", ["Queen"]);
    assert.equal(remastered, original);
  });

  it("should match versions with year prefix before remaster", () => {
    const original = normalizeTrackSignature("Time", ["Pink Floyd"]);
    const remastered = normalizeTrackSignature("Time - 2011 Remastered", ["Pink Floyd"]);
    assert.equal(remastered, original);
  });

  it("should match parenthesized and bracketed remaster notes", () => {
    const original = normalizeTrackSignature("Heroes", ["David Bowie"]);
    const inParens = normalizeTrackSignature("Heroes (2017 Remaster)", ["David Bowie"]);
    const inBrackets = normalizeTrackSignature("Heroes [Remastered]", ["David Bowie"]);
    assert.equal(inParens, original);
    assert.equal(inBrackets, original);
  });

  it("should be case-insensitive and compare primary artist", () => {
    const sigA = normalizeTrackSignature("STAY", ["The Kid LAROI", "Justin Bieber"]);
    const sigB = normalizeTrackSignature("stay", ["the kid laroi"]);
    assert.equal(sigA, sigB);
  });
});
