"use strict";

var $ = require('jquery'),
    _ = require('underscore'),
    Backbone = require('backbone'),
    models = require('../models'),
    helpers = require('../helpers'),
    utils = require('../utils'),
    logger = require('../logger'),
    BaseView = require('./base_view'),
    ace = require('brace'),
    pym = require('pym.js'),
    slugify = require("underscore.string/slugify");

require('brace/mode/json');
require('brace/theme/textmate');

function pluckAttr(models, attribute) {
  return _.map(models, function(t) { return t.get(attribute); });
}

function isVisible(control) {
  return control.type !== 'hidden' && $(control.domEl).is(':visible');
}

var ProjectSaveModal = Backbone.View.extend({

    id: 'save-modal',
    className: 'modal show',
    template: require('../templates/modal.ejs'),

    events: {
      'hidden': 'teardown',
      'click #closeModal': 'closeModal',
      'click #dismiss': 'cancel',
      'click #save': 'submit',
      'click': 'closeModal'
    },

    initialize: function(options) {
      _.bindAll(this, 'show', 'teardown', 'render', 'renderView');
      logger.debug('init options', options);
      if (_.isObject(options)) {
        _.extend(this, _.pick(options, 'app', 'parentView'));
      }
      this.render();
    },

    show: function() {
      this.$el.modal('show');
    },

    teardown: function() {
      this.$el.data('modal', null);
      this.remove();
    },

    render: function() {
      this.renderView(this.template);
      return this;
    },

    renderView: function(template) {
      this.$el.html(template());
      this.$el.modal({show:false}); // dont show modal on instantiation
    },

    cancel: function(){
      $('.project-save-warning').hide();
      this.trigger('cancel');
      this.teardown();
    },

    submit: function(){
      var self = this;
      this.parentView
        .doSubmit( this.parentView.$('#projectForm form') )
        .then(function() {
          self.trigger('submit');
          self.teardown();
        });
    },

    closeModal: function(eve){
      if($(eve.target).hasClass('modal-backdrop') || $(eve.target).is('#closeModal')){
        this.teardown();
        this.trigger('close');
      }
    },
 });

var EditProject = BaseView.extend(require('./mixins/actions'), require('./mixins/form'), {
  template: require('../templates/project.ejs'),
  forceUpdateDataFlag: false,
  previousData: null,
  events: {
    'change :input': 'stopListeningForChanges',
    'change form': 'pollChange',
    'keyup #shareText': 'getTwitterCount',
    'keypress': 'pollChange',
    'click #savePreview': 'savePreview',
    'click .resize': 'resizePreview',
    'click #saveBtn': 'handleForm',
    'mousedown #split-bar': 'enableFormResize',
    'mouseup': 'disableFormResize',
    'mousemove': 'resizeForm'
  },

  afterInit: function(options) {
    var view = this;
    this.disableForm = options.disableForm ? true : false;
    this.copyProject = options.copyProject ? true : false;
    if(options.query){
      this.togglePreview = options.query.togglePreview ? true : false;
    }

    window.onbeforeunload = function(event) {
      if(view.hasUnsavedChanges()){
        return 'You have unsaved changes!';
      }
    };

    this.on('load', function() {
      this.listenTo(this.app, 'loadingStart', this.stopListeningForChanges, this);
      this.listenTo(this.app, 'loadingStop', this.listenForChanges, this);
      $('#navbar-save-container').show();
      if ( this.model.hasPreviewType('live') && this.model.getConfig().spreadsheet_template ) {
        // If we have a google spreadsheet, update preview on window focus
        this.listenTo(this.app, 'focus', this.focusPollChange, this);
      }
    }, this);

    this.on('unload', function() {
      this.stopListening(this.app);
      this.stopListeningForChanges();
      $('#navbar-save-container').hide();
      if ( this.pym ) { this.pym.remove(); }
    }, this);
  },

  askToSave: function() {
    var view = this;
    var saveModal = new ProjectSaveModal({app: this.app, parentView: this}),
        ret = new Promise(function(resolve, reject) {
          saveModal.once('cancel submit', function() {
            resolve(true);
          });
          saveModal.on('close', function() {
            resolve(false);
          });
        });

    if($('#save-modal').length === 0){
      saveModal.show();
    }

    return ret;
  },

  enableFormResize: function(event){
    this.enableFormSlide = true;
  },

  disableFormResize: function(event){
    if(this.enableFormSlide){
      $('#embed-preview').removeClass('screen');
      this.enableFormSlide = false;
    }
  },

  resizeForm: function(event){
    var view = this;
    if(view.enableFormSlide){
      if($(window).width() > 768){
        $('#embed-preview').addClass('screen');
        if(event.pageX > 320 && $(window).width() - event.pageX > 300){
          view.formWidth = $(window).width() - event.pageX;
          $('#form-pane').css("width", view.formWidth);
          $('#preview-pane').css("width", event.pageX);
          view.showPreviewButtons();
        }
      }
    }
  },

  showPreviewButtons: function(){
    $('.nav-pills button').show();
    if($('#preview-pane').width() > 700){
      $('.nav-pills #fluid-view').trigger('click');
    } else if($('#preview-pane').width() > 400 && $('#preview-pane').width() < 701){
      $('.nav-pills #fluid-view').trigger('click');
      $('.nav-pills #medium-view').hide();
    } else {
      $('.nav-pills .resize#small-view').trigger('click');
      $('.nav-pills button').hide();
      if($(window).width() > 768){
        $('.nav-pills .resize#small-view').show();
      }
    }
    $('.nav-pills li button').show();
  },

  hasUnsavedChanges: function(){
    var view = this,
        data = view.alpaca.getValue();

    if(_.isEqual(view.formDataOnLoad, data) ){
      return false;
    } else {
      return true;
    }
  },

  focusPollChange: function(){
    this.forceUpdateDataFlag = true;
    this.pollChange();
  },

  pollChange: _.debounce(function(){
    this.alpaca.childrenByPropertyId["tweet_text"].setValue($('textarea#shareText').val());

    var view = this,
        $form = this.$('#projectForm'),
        query = '',
        data = $form.alpaca('get').getValue();

    if(view.postedPreviewData){
      data = view.postedPreviewData;
    }

    if(this.hasUnsavedChanges()){
      $('.project-save-warning').show().css('display', 'inline-block');
      $('.project-saved').hide();
    } else {
      $('.project-save-warning').hide();
      $('.project-saved').show().css('display', 'inline-block');
    }

    // Make sure the form is valid before proceeding
    // Alpaca takes a loooong time to validate a complex form
    if ( !this.formValidate(this.model, $form) ) {
      // If the form isn't valid, bail
      return;
    } else {
      if( this.forceUpdateDataFlag ){
        // Check the flag in case we want to force an update
        query = '?force_update=true';
        this.forceUpdateDataFlag = false;
      } else if ( _.isEqual( this.previousData, data ) && !$('#embed-preview').hasClass('loading') ) {
        // If data hasn't changed, bail
        return;
      }

      logger.debug('pollchange');

      // stash data so we can see if it changed
      this.previousData = data;

      // Now that data is connected and valid, show some sort of loading indicator:
      if($('#embed-preview.validation-error')){
        $('#embed-preview').removeClass('validation-error').addClass('loading');
      }

      return $.ajax({
        type: "POST",
        url: this.model.url() + "/preview_build_data" + query,
        data: JSON.stringify(data),
        contentType: 'application/json',
        dataType: 'json'
      }).then(function( data ) {
        logger.debug('Updating live preview...');
        var iframeLoaded = _.once(function() {
          view.pym.sendMessage('updateData', JSON.stringify(data));
          $('#embed-preview').removeClass('loading');
        });

        if(data.theme !== view.theme || !view.pym){
          if(typeof data.theme !== 'undefined'){
            view.theme = data.theme;
            view.getTwitterCount();
          }
          var version = view.model.getVersion(),
            previewSlug = view.model.isThemeable() ?
                version :[version, view.theme].join('-'),
            previewUrl = view.model.blueprint.getMediaUrl( previewSlug + '/preview');

          if ( view.pym ) { view.pym.remove(); }
          view.pym = new pym.Parent('embed-preview', previewUrl);
          view.pym.iframe.onload = iframeLoaded;

          // In case some dumb script hangs the loading process
          setTimeout(iframeLoaded, 20000);
        } else {
          iframeLoaded();
        }
      }, function(err) {
        if ( err.status < 500 ) {
          view.app.view.error(
            "Can't update live preview (" +err.responseJSON.error+").", 'permanent');
        } else {
          view.app.view.error(
            "Could not update live preview, please contact support.", 'permanent' );
          logger.error(err);
        }
      });
    }
  }, 500),

  getTwitterCount: function(){
    var view = this;
    var getTwitterHandleLength = function(slug){
     return view.twitterHandles[slug] ? view.twitterHandles[slug].length : 0;
    };

    if ( view.model.hasBuildData() ) {
      var maxLen = 140 - ( 26 + getTwitterHandleLength(view.theme)),
          currentVal = maxLen - $('textarea#shareText').val().length;

      $('#tweetChars').html(currentVal);
      if(currentVal < 1){
        $('#tweetChars').addClass('text-danger');
      } else {
        $('#tweetChars').removeClass('text-danger');
      }
    }
  },

  savePreview: function(){
    this.$('#projectForm form').submit();
  },

  resizePreview: function(eve) {
    var $btn = $(eve.currentTarget);

    $btn
      .addClass('active')
      .siblings().removeClass('active');

    $('.preview-frame')
      .removeClass()
      .addClass('preview-frame ' + $btn.attr('id'));
  },

  listenForChanges: function() {
    if ( !this.model.isNew() && !this.listening ) {
      this.listenTo(this.app.messages,
                    'change:project:' + this.model.id,
                    this.updateStatus, this);
      this.listening = true;
    }
  },

  stopListeningForChanges: function() {
    this.stopListening(this.app.messages);
    this.listening = false;
  },

  updateStatus: function(status) {
    // don't care about the updated step
    if ( status === 'updated' ) { return; }

    logger.debug('Update project status: ' + status);
    if (status === 'built'){
      if(!this.model.hasPreviewType('live')){
        $('#embed-preview').removeClass('loading');
      }
      this.app.view.success('Building complete');
    }

    // fetch the model, re-render the view and catch errors
    var view = this;
    Promise
      .resolve(this.model.fetch())
      .then(function() {
        return view.render();
      }).catch(function(jqXHR) {
        view.app.view.displayError(
          jqXHR.status, jqXHR.statusText, jqXHR.responseText);
      });
  },

  templateData: function() {
    return {
      model: this.model,
      collection: this.collection,
      app: this.app,
      query: this.query,
      copyProject: this.copyProject
    };
  },

  beforeRender: function() {
    $('.project-save-warning').hide();
    this.stopListeningForChanges();
  },

  beforeSubmit: function() {
    this.stopListeningForChanges();
  },

  afterRender: function() {
    var view = this, promises = [];

    view.enableFormSlide = false;
    view.showPreviewButtons();
    $(window).resize(function(){
      view.showPreviewButtons();
      if(view.formWidth){
        if($(window).width() > 768){
          $('#form-pane').css("width", view.formWidth);
          $('#preview-pane').css("width", $(window).width() - view.formWidth);
        } else {
          $('#form-pane').css("width", '100%');
          $('#preview-pane').css("width", '100%');
        }
      }
    });

    // autoselect embed code on focus
    this.$("#embed textarea").focus( function() { $(this).select(); } );

    // Setup editor for data field
    if ( this.app.hasRole('superuser') ) {
      this.editor = ace.edit('blueprint-data');
      this.editor.setShowPrintMargin(false);
      this.editor.setTheme("ace/theme/textmate");
      this.editor.setWrapBehavioursEnabled(true);

      var session = this.editor.getSession();
      session.setMode("ace/mode/json");
      session.setUseWrapMode(true);

      this.editor.renderer.setHScrollBarAlwaysVisible(false);

      this.editor.setValue(
        JSON.stringify( this.model.buildData(), null, "  " ), -1 );

      var debouncedStopListeningForChanges = _.once(
        _.bind(this.stopListeningForChanges, this));
      this.editor.on("change", function() {
        logger.debug('editor content changed');
        debouncedStopListeningForChanges();
      });
    }

    promises.push( new Promise( function(resolve, reject) {
      view.renderForm(resolve, reject);
    } ) );

    return Promise.all(promises)
      .then(function() {
        var formData = view.alpaca.getValue(),
            buildData = view.model.buildData(),
            previewUrl = '', iframeLoaded,
            previewSlug = '';

        view.$('#shareText').val(formData['tweet_text']);
        view.formDataOnLoad = formData;

        // Callback for when iframe loads
        iframeLoaded = _.once(function() {
          logger.debug('iframeLoaded');
          if ( view.model.hasPreviewType('live') && view.model.hasBuildData() ) {
            view.pollChange();
          } else {
            if(!view.model.hasStatus('building')){
              $('#embed-preview').removeClass('loading');
            }
          }
        });

        // Figure out preview url
        if ( view.model.hasPreviewType('live') ) {
          // if the project has live preview enabled
          view.theme = view.model.get('theme') || formData['theme'] || 'custom';

          previewSlug = view.model.isThemeable() ? view.model.getVersion() :
            [view.model.getVersion(), view.theme].join('-');
          previewUrl = view.model.blueprint.getMediaUrl( previewSlug + '/preview');

        } else if ( view.model.hasType( 'graphic' ) && view.model.hasInitialBuild() ){
          // if the project is a graphic and has been built (but doesn't have live enabled)
          var previousPreviewUrl = view.model['_previousAttributes']['preview_url'];

          if(previousPreviewUrl && previousPreviewUrl !==  view.model.get('preview_url')){
            previewUrl = previousPreviewUrl;
          } else {
            previewUrl = view.model.get('preview_url');
          }
        }

        if ( view.model.hasType( 'graphic' ) || view.model.hasPreviewType('live') ) {
          // Setup our iframe with pym
          if ( view.pym ) { view.pym.remove(); }
          if ( view.formValidate(view.model, view.$('#projectForm')) ){
            view.pym = new pym.Parent('embed-preview', previewUrl);
            view.pym.iframe.onload = iframeLoaded;
          }
          // In case some dumb script hangs the loading process
          setTimeout(iframeLoaded, 20000);
        }
        if(view.model.hasPreviewType('live')){
          if(view.model.getConfig().spreadsheet_template){
            $( "input[name='google_doc_url']" ).after('<b><a type="button" id="spreadsheet-button" data-hook="create-spreadsheet">Create new empty spreadsheet</a></b>');
          }
        }
        view.getTwitterCount();
      }).catch(function(err) {
        console.error(err);
      }).then(function() {
        view.listenForChanges();
      });
  },

  afterSubmit: function() {
    this.listenForChanges();
    if (this.model.hasStatus('building')){
      if(!this.model.hasPreviewType('live')){
        $('#embed-preview').addClass('loading');
      }
      this.app.view.alert(
        'Building... This might take a moment.', 'notice', 16000);
    }
  },

  renderForm: function(resolve, reject) {
    var $form = this.$('#projectForm'),
        view = this,
        form_config, availableThemes, newProject, populateForm = false;

    if ( this.disableForm ) {
      $form.append(
        '<div class="alert alert-warning" role="alert">Form is disabled</div>');
      return resolve();
    }

    // Prevent return or enter from submitting the form
    $form.keypress(function(event){
      var field_type = event.originalEvent.srcElement.type;
      if (event.keyCode === 10 || event.keyCode === 13){
        if(field_type !== 'textarea'){
          event.preventDefault();
        }
      }
    });

    newProject = false;
    if ( this.model.isNew() || this.copyProject ) {
      newProject = true;
    }

    form_config = this.model.getConfig().form;

    availableThemes = this.model.getConfig().themes ?
      _.filter(this.app.themes.models, _.bind(function(t) {
        return _.contains(this.model.getConfig().themes, t.get('slug'));
      }, this)) : this.app.themes.models;
    availableThemes = availableThemes || this.app.themes.where({slug : 'generic'});
    this.twitterHandles = _.object(this.app.themes.pluck('slug'), this.app.themes.pluck('twitter_handle'));

    if(_.isUndefined(form_config)) {
      this.app.view.error('This blueprint does not have a form!');
      reject('This blueprint does not have a form!');
    } else {
      var schema_properties = {
        "title": {
          "title": "Title",
          "type": "string",
          "required": true
        },
        "theme": {
          "title": "Theme",
          "type": "string",
          "required": true,
          "default": pluckAttr(availableThemes, 'slug')[0],
          "enum": pluckAttr(availableThemes, 'slug')
        },
        "slug": {
          "title": "Slug",
          "type": "string"
        },
        "tweet_text":{
          "type": "string",
          "minLength": 0
        }
      },
      options_form = {
        "attributes": {
          "data-model": "Project",
          "data-model-id": this.model.isNew() ? '' : this.model.id,
          "data-action": this.model.isNew() ? 'new' : 'edit',
          "data-next": 'show',
          "method": 'post'
        }
      },
      options_fields = {
        "theme": {
          "type": "select",
          "optionLabels": _.map(availableThemes, function(t){
               if (t.get('title') === t.get('group_name')) {
                 return t.get('group_name');
               }
               return t.get('group_name') + ' - ' + t.get('title');
             })
        },
        "slug": {
          "label": "Slug",
          "validator": function(callback){
            var slugPattern = /^[0-9a-z\-_]{0,60}$/;
            var slug = this.getValue();
            if ( slugPattern.test(slug) ){
              callback({ "status": true });
            } else if (slugPattern.test(slug.substring(0,60))){
              this.setValue(slug.substr(0,60));
              callback({ "status": true });
            } else {
              callback({
                "status": false,
                "message": "Must contain fewer than 60 numbers, lowercase letters, hyphens, and underscores."
              });
            }
          }
        },
        "tweet_text":{
          "label": "Social share text",
          "constrainMaxLength": true,
          "constrainMinLength": true,
          "showMaxLengthIndicator": true,
          "fieldClass": "hidden"
        }
      };

      // if there is only one theme option, hide the dropdown

      // Temporarily disabling theme drop down hiding to fix custom color bug
      //if ( availableThemes.length === 1 ) {
      //  options_fields['theme']['fieldClass'] = 'hidden';
      //}

      // hide slug for blueprint types that are not apps
      if ( !_.contains(this.app.config.editable_slug_types, this.model.blueprint.get('type') ) ) {
        options_fields['slug']['fieldClass'] = 'hidden';
      }

      _.extend(schema_properties, form_config.schema.properties || {});
      if( form_config.options ) {
        _.extend(options_form, form_config.options.form || {});
        _.extend(options_fields, form_config.options.fields || {});
      }

      var opts = {
        "schema": {
          "title": function(){
            if(view.model.hasPreviewType('live')){
              return '';
            } else {
              return view.model.blueprint.get('title');
            }
          },
          "description": this.model.getConfig().description,
          "type": "object",
          "properties": schema_properties
        },
        "options": {
          "form": options_form,
          "fields": options_fields,
          "focus": this.firstRender
        },
        "postRender": function(control) {
          view.alpaca = control;

          view.alpaca.childrenByPropertyId["slug"].setValue(
            view.model.get('slug_sans_theme') );

          resolve();
        }
      };

      if( form_config['view'] ) {
        opts.view = form_config.view;
      }

      if(!this.model.isNew() || this.copyProject) {
        populateForm = true;
      } else if (this.model.isNew() && !this.copyProject && !this.model.hasInitialBuild()){
        var uniqBuildVals = _.uniq(_.values(this.model.buildData()));
        if (!( uniqBuildVals.length === 1 && typeof uniqBuildVals[0] === 'undefined')){
          populateForm = true;
        }
      }

      if(populateForm){
        opts.data = this.model.formData();
        if ( !_.contains(pluckAttr(availableThemes, 'slug'), opts.data.theme) ) {
          opts.data.theme = pluckAttr(availableThemes, 'slug')[0];
        }
      }

      $form.alpaca(opts);
    }
  },

  formValues: function($form) {
    var control = $form.alpaca('get'), data;

    logger.debug('form values');

    if ( control ) {
      data = control.getValue();
    } else {
      try {
        data = JSON.parse(this.editor.getValue());
      } catch (ex) {
        return {};
      }
    }

    var vals = {
      title: data['title'],
      theme: data['theme'],
      data:  data,
      blueprint_id: this.model.blueprint.get('id'),
      blueprint_version: this.model.getVersion()
    };

    if ( data.slug && data.slug.indexOf(data['theme']) !== 0 ) {
      vals.slug = data['theme'] + '-' + data['slug'];
    }

    return vals;
  },

  formValidate: function(inst, $form) {
    var control = $form.alpaca('get'), valid = false;

    logger.debug('form validate');

    if ( control ) {
      // Validate the alpaca form
      control.form.refreshValidationState(true);
      valid = control.form.isFormValid();

      if ( !valid ) {
        $form.find('#validation-error').removeClass('hidden');
      } else {
        $form.find('#resolve-message').removeClass('hidden');
        $form.find('#validation-error').addClass('hidden');
      }
    } else {
      // Validate the raw data editor
      try {
        JSON.parse(this.editor.getValue());
        valid = true;
      } catch (ex) {
        logger.error("Blueprint raw JSON is bad");
      }
    }
    return valid;
  },

  copyEmbedToClipboard: function() {
    // select text from
    this.$( '#embedText' ).select();
    try {
      // copy text
      document.execCommand( 'copy' );
      this.app.view.alert( 'Embed code copied to clipboard!' );
    } catch ( err ) {
      this.app.view.alert( 'Please press Ctrl/Cmd+C to copy the text.' );
    }
  },

  /**
   * Create a new spreadsheet from a template
   * @returns {Promise} Promise to provide the Google Doc URL
   **/
  createSpreadsheet: function() {
    var model = this.model, view = this;
    if ( !model.getConfig().spreadsheet_template ) { return Promise.resolve(); }

    var ss_key = model.getConfig().spreadsheet_template.match(/[-\w]{25,}/)[0];

    var $input = $( "input[name='google_doc_url']" );
    if( $input.val().length > 0 ) {
      var msg = 'This will replace the spreadsheet link currently associated with this project. Click "OK" to confirm the replacement.';
      if ( !window.confirm(msg) ) { return Promise.resolve(); }
    }

    return Promise.resolve( $.ajax({
      type: "POST",
      url: model.urlRoot + "/create_spreadsheet",
      data: JSON.stringify(ss_key),
      contentType: 'application/json',
      dataType: 'json'
    }) ).then(
      function( data ) {
        $input
          .val(data.google_doc_url)
          .focus();
        view.alpaca.form.refreshValidationState(true);
      },
      function(err) {
        var msg = 'There was an error authenticating your Google account.';
        view.app.view.error(msg);
        logger.error(msg, err);
      }
    );
  },
} );

module.exports = EditProject;
