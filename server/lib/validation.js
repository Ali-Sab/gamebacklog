"use strict";

const PLATFORMS = ["pc", "ps5"];
const INPUTS    = ["kbm", "ps5-controller", "xbox-controller"];

function validateGameFields(fields, { partial = false } = {}) {
  if (!partial) {
    if (!fields.title || typeof fields.title !== "string" || !fields.title.trim()) {
      return "title is required";
    }
  } else if (fields.title !== undefined && (typeof fields.title !== "string" || !fields.title.trim())) {
    return "title must be a non-empty string";
  }
  if (fields.platform != null && !PLATFORMS.includes(fields.platform)) {
    return `platform must be one of: ${PLATFORMS.join(", ")}`;
  }
  if (fields.input != null && !INPUTS.includes(fields.input)) {
    return `input must be one of: ${INPUTS.join(", ")}`;
  }
  if (fields.url != null && typeof fields.url !== "string") return "url must be a string";
  if (fields.imageUrl != null && typeof fields.imageUrl !== "string") return "imageUrl must be a string";
  return null;
}

module.exports = { PLATFORMS, INPUTS, validateGameFields };
