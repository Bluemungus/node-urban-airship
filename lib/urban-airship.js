'use strict';

var mongoose = require('mongoose'),
	async = require('async'),
	querystring = require('querystring'),
	https = require('https'),
	fs = require('fs'),
	moment = require('moment'),
	UA = require("urban-airship"),
	_  = require('lodash');

// LOAD MODELS
var Customer = mongoose.model('Customer'),
	Category = mongoose.model('Category'),
	Message  = mongoose.model('Message'),
	Client_Settings = mongoose.model('Customer_Settings');

// MESSAGES API
// ============

function _returnGroupedMessages(res, messages) {
	var groupedMessages = _.groupBy(messages, function(message) {
		var group = '';
		if (message.deleted)
			group = 'deleted';
		else 
			group = 'archived';
		return group;
	});

	return res.json(groupedMessages);
}

// GET: Messages by Customer API KEY
exports.listMessages = function (req, res) {

	checkForUAKeys(req.cookies.cid, function (keys, err){
		if (keys) {
			console.log("client has UA keys :\n");
			return Message.find({
				'cid': req.cookies.cid
			}, function (err, messages) {
				if (!err) {
					_returnGroupedMessages(res, messages);
				} else {
					return res.send(err);
				}
			});
		}else{
			console.log("client does not have UA keys",err);
			res.statusCode = 204;
			return res.send(err);
		}
	});

};

// GET: Message by Customer API KEY
exports.getMessage = function (req, res) {
	var params = req.params;
	Message.findById(params['_id'], function (err, event) {
		if (!err) {
			return res.json(event);
		} else {
/** @todo: IMPLEMENT ERROR HANDLING */
			return res.send({error: err});
		}
	});
};

var checkForUAKeys = function(cid,callback){

	if (typeof cid !== 'undefined') {
		Client_Settings.find(({
			'cid': cid
		}), function (err, settings){
			if(!err){

				var keys = {};

				if(settings[0].liveAppKey){
					keys.liveAppKey = settings[0].liveAppKey;
				}

				if(settings[0].liveSecretKey !== null){
					keys.liveSecretKey = settings[0].liveSecretKey;
				}

				if(settings[0].masterSecretKey){
					keys.masterSecretKey = settings[0].masterSecretKey;
				}

				if (keys.masterSecretKey && keys.liveSecretKey && keys.liveAppKey) {
					callback(keys);
				}else{
					callback(null, 'got settings but couldn\'t find UA keys:',keys);
				}

			}else{
				callback(null, err);
			}
		});
	} else {
		callback(null, 'no cid');
	}
};

// POST: New Message
exports.sendMessage = function (req, res) {
	console.log("push it, push it real good. : ",req.body.acmessage.cid);
	var message = req.body.acmessage;
	checkForUAKeys(req.body.acmessage.cid, function (keys, err){
		if (keys) {
			console.log("client has UA keys :\n");
		}else{
			console.log("client does not have UA keys",err);
		}
	});


	Client_Settings.find(({
		'cid': req.body.acmessage.cid
	}), function (err, settings) {
		if(!err){

			checkForUAKeys(req.cookies.cid, function (keys, err) {

				if (keys) {

					var ua = new UA(keys.liveAppKey, keys.liveSecretKey, keys.masterSecretKey);
					sendMessagetoDeviceTokens(ua, message.body, message.groups);

					if(!message.resend){
						message.created = new moment();
						message.cid = req.cookies.cid;
						_archiveMessage(res, req,  message);
					}

					Message.find({
						'cid': req.cookies.cid
					}, function (err, messages) {
						if (!err) {
							_returnGroupedMessages(res, messages);
						} else {
							return res.send(err);
						}
					});

				} else {
					console.log('no cid');// error no client id
				}
			});
		} else {
			console.log(err); // error getting client settings
		}
	}); // make this a more better closure
};

exports.getTags = function (req, res) {
		
	checkForUAKeys(req.cookies.cid, function (keys, err){
		if (keys) {
			var ua = new UA(keys.liveAppKey, keys.liveSecretKey, keys.masterSecretKey);
			ua.getTags(function(error, result, data){
				if (error) {
					console.log('couldnt get tags real good',error);
					res.send(error);
				} else {
					console.log('gotted tags real good',result);		
					res.send(data);
				}
			});
		} else {
			console.log("client does not have UA keys for get tags ",err);
			res.send(err);
		}
	});

};

exports.deleteTag = function (req, res) {

	checkForUAKeys(req.cookies.cid, function (keys, err){
		if (keys) {
			var ua = new UA(keys.liveAppKey, keys.liveSecretKey, keys.masterSecretKey);
			var delTag = req.body.tag;
			ua.deleteTag(delTag, function(deleteErr, result){
				if(deleteErr){
					console.log('couldnt delete tags real good',deleteErr);
					res.send(deleteErr);
				} else {
					ua.getTags(function(getErr, result, data){
						if (getErr) {
							console.log('couldnt get tags after delete real good',getErr);
							res.send(getErr);
						}else{
							console.log('deleted tags real good',result);		
							res.send(data);
						}
					});
				}
			});
		}
	});
};

exports.addTag = function (req, res) {

	checkForUAKeys(req.cookies.cid, function (keys, err){
		var ua = new UA(keys.liveAppKey, keys.liveSecretKey, keys.masterSecretKey);
		var tagText = req.body.tag;
		console.log(tagText);
		ua.createTag(tagText, function(err,result) {
			if(err){
				console.log(err);
			} else {
				ua.getTags(function(error, result, data){
					if (err) {
						console.log('couldnt get it real good',err);
					}else{
						console.log('gotted tags real good',result);		
						res.send(data);
					}
				});
			}
		});
	});
}

function sendMessagetoDeviceTokens(ua, message, tags) {

	var payload = {};
	if (tags && tags.length > 0) {
		payload = {
			"audience":{
				"tags": tags
			},
			"device_types": "all",
			"notification": message,
		};
	} else {
		payload = {
			"audience" : "all",
			"notification":{
			       "alert" : message
			},
			"device_types": "all"
		};
	}

	ua.pushNotification(payload, function(error, result) {
		if (error) {
			console.log('couldnt push it real good : ', error, payload);
		}else{
			console.log('pushed message real good',result);		
		}
	});
	
}

function _archiveMessage(res, req, acmessage){
	Message.create(acmessage, function (err){
		if(err){
			console.log('Failed to archive message', err);
		} else {
			console.log('Archived message');
			Message.find(({
				'cid': req.headers.cid
			}), function(err, messages){
				if(err){
					res.send(err);
				} else {
					_returnGroupedMessages(res, messages);
				}
			});
		}
	});
}

// PUT: Update Message
exports.updateMessage = function (req, res) {
	return res.json('not_yet_implemented');
}
