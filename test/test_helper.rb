ENV['RAILS_ENV'] ||= 'test'
require File.expand_path('../../config/environment', __FILE__)
require 'rails/test_help'

OmniAuth.config.test_mode = true
OmniAuth.config.add_mock(:developer, OmniAuth::AuthHash.new(
  :provider => 'developer',
  :uid => 'test@example.com',
  :info => { :name => 'test', :email => 'test@example.com' }
))

# Make some temporary working dirs
require 'tmpdir'
require 'fileutils'
Rails.configuration.working_dir = File.expand_path(
  "#{Dir.tmpdir}/#{Time.now.to_i}#{rand(1000)}/")
Rails.configuration.blueprints_dir = File.join(
  Rails.configuration.working_dir, 'blueprints')
Rails.configuration.projects_dir = File.join(
  Rails.configuration.working_dir, 'projects')

# pretty print
require 'pp'

# Add more helper methods to be used by all tests here...
class ActiveSupport::TestCase
  def setup
    [:working_dir, :blueprints_dir, :projects_dir].each do |s|
      Dir.mkdir(Rails.configuration.try(s)) \
        unless Dir.exist?(Rails.configuration.try(s))
    end
  end

  def teardown
    FileUtils.rm_rf(Rails.configuration.working_dir) \
      if File.exist?(Rails.configuration.working_dir)
  end

  def mock_auth
    OmniAuth.config.mock_auth
  end

  def repo_url
    'https://github.com/ryanmark/autotune-example-blueprint.git'
  end
end

# Helpers for controller tests
class ActionController::TestCase
  def valid_auth_header!
    @request.headers['Authorization'] = "API-KEY auth=#{users(:developer).api_key}"
  end

  def accept_json!
    @request.headers['Accept'] = 'application/json'
  end

  def decoded_response
    ActiveSupport::JSON.decode(@response.body)
  end

  # Take an array of keys and assert that those keys exist in decoded_response
  def assert_data(*args)
    assert_keys decoded_response, *args
  end

  # Take a hash and an array of keys and assert that those keys exist
  def assert_keys(data, *args)
    assert_instance_of Hash, data
    keys = args.first.is_a?(Array) ? args.first : args
    keys.each do |k|
      assert decoded_response.key?(k), "Should have #{k}"
    end
  end
end
