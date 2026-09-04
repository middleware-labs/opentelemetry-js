'use strict';
const { vcsDetector } = require('./lib/vcs-detector');
const {
  ExceptionStackDetailsSpanProcessor,
} = require('./lib/exception-stack-details-processor');
const {
  buildExceptionStackDetails,
} = require('./lib/exception-stack-details');

module.exports = {
  vcsDetector,
  ExceptionStackDetailsSpanProcessor,
  buildExceptionStackDetails,
};
