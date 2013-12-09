/*jslint node: true */
"use strict";
// Models Controller
// * * * * * * * * * * 
var Model3d = require('./../models/model3d_schema'); 
var File = require('./../models/file_schema'); 
var User = require('./../models/user_schema'); 
var Auth = require('./authentication_controller');

var Grid = require("gridfs-stream");
var mongoose = require('mongoose');
Grid.mongo = mongoose.mongo;

var conn = mongoose.createConnection('mongodb://localhost/mmdb');

conn.on('error', console.error.bind(console, 'connection error:'));

var stripe = require("stripe")(
  "sk_test_SBwGeHO10EJ0xTnmImA0W3uC"
);

var async = require('async');

// models/new GET
function get_new(req, res){
    if(Auth.current_user(req) != null) {
        res.render('models/new', {selected: "upload"});
    }else {
        res.redirect('/login');
    }
}

// models/new POST
function post_new(req, res){
    console.log(req.body);
    console.log(req.files.model.path);
    console.log(Auth.current_user(req));

    var new_model3d = new Model3d.model({name : req.body.name || "undefined"
                                        ,description: req.body.description || "no description"
                                        ,price: parseFloat(req.body.price) || 0.0
                                        ,creator: Auth.current_user(req)
                                        });
    console.log("price : $" + new_model3d.price + " " + parseFloat(req.body.price));
    console.log("user: " + Auth.current_user(req));
    var new_file = new File.model({owner: new_model3d.id});

    /*  This shit should probably be done in the file_schema module */

    var obj_file_name = new_model3d.id + "_" + new_file.id + ".obj";
    var obj_file_type = "OBJ";

    new_file.location = obj_file_name;
    new_file.type = obj_file_type;

    //Do all 3 of these tasks in parallel asyncronously and then meetup at the end
    async.parallel([
        function(callback){
            File.move(new_file, req.files.model.path, obj_file_name, function(err){
                if(err)
                {
                    console.log("There was an error moving the file to uploads");
                    console.log(err);
                    callback(err);
                }
                else
                {
                    new_file.save(function (err, product, numberAffected) {
                        if(err){
                            console.log("There was an error saving the file to the db! \n" + err);
                        }
                        else {
                            console.log("File saved!");
                            callback(null, null); 
                        }
                    });
                } 
            });
        },
        function(callback){
            new_model3d.save(function (err, product, numberAffected) {
                if(err){
                    console.log("There was an error saving the model3d to the db! \n" + err);
                    callback(err);
                }
                else {
                    callback(null, product);
                }
            });
        }
    ], function (err, results){
        console.log(results);
        console.log("new model id: " + new_model3d.id);
        res.redirect("models/"+new_model3d.id);
    });
}

// models/:id GET
function get_show(req, res){
    Model3d.find_by_id(req.params.id, function(err, model_obj){ 
        if(err) res.status(501).send('something_broke :(');
        else
        {
            console.log(model_obj);
            model_obj.views = model_obj.views + 1; 
            var parent_id = model_obj._id;
            File.find_all_belonging_to_model_with_type(parent_id, "OBJ", function(err, file_obj_array)
            {
                var should_show_edit = (Auth.current_user(req) === model_obj.creator);
                console.log("show_edit: " + should_show_edit + "for user: " + Auth.current_user(req));
                var starred = model_obj.favorites.indexOf(Auth.current_user(req)) != -1;
                var logged_in = Auth.current_user(req) != null;
                res.render('models/show', {model: model_obj
                                          ,model_URL: file_obj_array[0].location
                                          , description: model_obj.description
                                          , show_edit: should_show_edit
                                          , starred: starred
                                          , logged_in: logged_in
                                          , keys: global.keys});
            });

            //save the model becasue we updated how many views it had
            model_obj.save(function(err){
                console.log(err);
            });
        } 
    });
}

// models/:id DELETE
function delete_model(req, res){
    Model3d.find_by_id(req.params.id, function(err, model_obj){
        //taruns code here. Delete(model_obj.upload) make a callback to call the code below.
        console.log(model_obj);
        File.delete_file(model_obj._id);
        
        model_obj.remove();
        User.find_by_name(model_obj.creator, function(err, user){
            if(err){
                console.log(err);
            }
            else{
                var index = user.uploads.indexOf(model_obj._id);
                if(index != -1){
                   user.uploads.splice(index, 1); 
                }
                user.save();
            }
        });
    });
}

// models/:id/star
function post_star(req, res){
    toggle_star(req, res, true);
}
// models/:id/unstar
function post_unstar(req, res){
    toggle_star(req, res, false);
}

// function toggle_star
//@param req: the http reqest
//@param res: the http respose
//@param increase: (bool) to increase or decrease the star cound for this model
function toggle_star(req, res, increase){
    //star button should not even apear if user isnt logged in
    var current_username = Auth.current_user(req)
    if(!current_username){
        res.status(403).send("hacking?");
        return;
    }
    async.waterfall([
        function(callback){
             Model3d.find_by_id(req.params.id, function(err, model_obj){
                if(err) callback(err);
                callback(err, model_obj);
             });
        },
        function(model_obj, callback){
            var index = model_obj.favorites.indexOf(current_username);
            if(index == -1 && increase)
            {
                model_obj.favorites =  model_obj.favorites || [];
                model_obj.favorites.push(current_username);
                model_obj.save();
            }
            else if(!increase){
                model_obj.favorites.splice(index, 1);
                model_obj.save();
            }
            callback(null, model_obj.favorites.length);
        }
    ],function (err, num_stars) {
        console.log("got this far");

        if(!err) res.status(200).send(" " + num_stars);
        else res.status(500).send();
    });
}

// models/:id/edit GET
function get_model_edit(req, res){
    Model3d.find_by_id(req.params.id, function(err, model_obj){ 
        if(err){
            console.log(err);
            res.status(500).send('something_broke :(');
            return;
        }
        if(Auth.current_user(req) == model_obj.creator){
            File.find_all_belonging_to_model_with_type(model_obj._id, "OBJ", function(err, file_obj_array)
            {
                res.render("models/edit", {model: model_obj, model_URL: file_obj_array[0].location});
                return;
            });
        }else{
            res.status(401).send('You are unauthorized to modify this model');
        }
    });
}

function get_buy(req, res){
    Model3d.find_by_id(req.params.id, function(err, obj){
        if(err) res.render('something_broke :(');
        else res.render('models/buy', {name: obj.name, description: obj.description, price: obj.price, id: obj._id});
    });
    //res.render('models/buy', {});
}
function post_buy(req, res){
    console.log("Reached here");
    stripe.setApiKey(global.keys.stripeSecretTest);
    var res_message;
    var stripeToken = req.body.stripeToken;
    var amount = req.body.amount;
    var currency = req.body.currency;
    var description = req.body.description;
    console.log(amount);
    console.log(stripeToken);
    console.log("crap");
    var charge = stripe.charges.create({
        amount: amount, // amount in cents, again
        currency: "usd",
        card: stripeToken,
        description: "description"
    }, function(err, charge) {
    if (err && err.type === 'StripeCardError') {
        console.log("ERROR");
        console.log(err);
    }
    else
    {
        if(charge["captured"])
        {
            res_message = "Your payment has been successful."
            console.log("Made charge");
            console.log(req.params.id);
            Model3d.find_by_id(req.params.id, function(err, obj){
                if(err){
                    console.log(err); 
                    res.send('something_broke :(');
                }
                else{
                    console.log(obj);
                    var creator = obj.creator;
                    User.find_by_name(creator, function(err, user_obj){
                        if(err){
                            console.log(err);
                        }
                        else{
                            //console.log(user_obj);
                            //console.log(user_obj.bankToken);
                            var recipient = stripe.recipients.retrieve(user_obj.recipientid, function(err, recipient){
                                if(err)
                                {
                                    console.log(err);
                                }
                                else
                                {
                                    console.log(recipient);
                                    stripe.transfers.create({
                                                amount: amount,
                                                currency: "usd",
                                                recipient: recipient["id"],
                                                description: "Transfer for test@example.com"
                                            }, function(err, transfer) {
                                                if(err)
                                                {
                                                    console.log(err);
                                                }
                                                else
                                                {
                                                    console.log(transfer);
                                                }
                                    });
                                }

                            });
                        }
                    });
                    res.render('models/buy', {name: obj.name,
                                               description: obj.description,
                                               price: obj.price,
                                               id: obj._id,
                                               message: res_message});
                    }
            });
        }
        else
        {
            res_message = "Your payment has been unsuccessful."
            console.log("No charge");
            //res.render('models/buy', {name: obj.name, description: obj.description, price: obj.price, id: obj._id, message: res_message});
        }
        //console.log(charge);
    }
    });
    
}

function get_file(req, res) {
    var gridfs = Grid(conn.db);
    Model3d.find_by_id(req.params.id, function(err, model_obj){ 
        File.model.find({owner : model_obj._id}, function(err, files){ 
            for (var index in files) {
                var file = files[index];
                console.log(file);

                var readstream = gridfs.createReadStream({_id : file.gridfs_id});
                console.log("readstream : " + readstream);
                res.header('Content-Type', 'plain/text');
                readstream.pipe(res);
            }
        });
    });
}

module.exports = {
    get_new: get_new,
    post_new: post_new,
    show: get_show,
    del: delete_model,
    get_edit: get_model_edit,
    get_buy: get_buy,
    get_file: get_file,
    post_buy: post_buy,
    post_star: post_star,
    post_unstar: post_unstar
}
