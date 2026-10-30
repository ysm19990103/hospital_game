'use strict';
module.exports = { createGame: require('./src/engine').createGame, createQuestionHistory: require('./src/question-history').createQuestionHistory, chapters: require('./data/chapters.json'), npcs: require('./data/npcs.json'), knowledge: require('./data/knowledge.json'), sideStories: require('./data/side-stories.json'), engineVersion: require('./manifest.json').engineVersion };
