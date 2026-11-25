"""URL Configuration for SafePass - Refactored"""

from django.urls import path, re_path
from django.conf import settings
from django.views.static import serve
from . import views

urlpatterns = [
    # ========================================================================
    # TEMPLATE VIEWS (HTML Pages)
    # ========================================================================
    path('', views.login_page, name='home'),
    path('auth/login', views.login_page, name='login_page'),
    path('auth/register', views.register_page, name='register_page'),
    
    path('dashboard', views.dashboard_page, name='dashboard'),
    path('passwords', views.passwords_page, name='passwords'),
    path('passwords/add', views.password_add_page, name='password_add'),
    path('passwords/<int:password_id>/edit', views.password_edit_page, name='password_edit'),
    path('generator', views.generator_page, name='generator'),
    path('siber-test', views.siber_test_page, name='siber_test'),
    path('profile', views.profile_page, name='profile'),
    path('settings', views.settings_page, name='settings'),
    path('trash', views.trash_page, name='trash'),
    path('notifications', views.notifications_page, name='notifications'),
    path('import-export', views.import_export_page, name='import_export'),
    path('definitions', views.definitions_page, name='definitions'),
    
    # ========================================================================
    # API ENDPOINTS (JSON Responses)
    # ========================================================================
    path('api/auth/register', views.api_register, name='api_register'),
    path('api/auth/login', views.api_login, name='api_login'),
    path('api/auth/logout', views.api_logout, name='api_logout'),
    path('api/auth/recover', views.api_recover_account, name='api_recover_account'),
    path('api/profile/recovery-key', views.api_recovery_key, name='api_recovery_key'),
    path('api/profile/whats-new-seen', views.api_whats_new_seen, name='api_whats_new_seen'),
    path('api/auth/check', views.api_check_auth, name='api_check_auth'),
    path('api/auth/session', views.api_session_status, name='api_session_status'),
    path('api/auth/session/refresh', views.api_session_refresh, name='api_session_refresh'),
    path('api/settings', views.api_settings, name='api_settings'),
    path('api/notifications', views.api_notifications, name='api_notifications'),
    path('api/notifications/read', views.api_notifications_read, name='api_notifications_read'),
    path('api/notifications/delete', views.api_notifications_delete, name='api_notifications_delete'),
    path('api/trash/empty', views.api_trash_empty, name='api_trash_empty'),
    path('api/trash/<int:password_id>/restore', views.api_trash_restore, name='api_trash_restore'),
    path('api/trash/<int:password_id>/delete', views.api_trash_delete, name='api_trash_delete'),
    path('api/trash/definitions/<str:kind>/<int:item_id>/<str:action>', views.api_trash_definition, name='api_trash_definition'),
    path('api/auth/change-master-password', views.api_change_master_password, name='api_change_master_password'),

    path('api/definitions', views.api_definitions, name='api_definitions'),
    path('api/definitions/categories', views.api_category_save, name='api_category_create'),
    path('api/definitions/categories/<int:category_id>', views.api_category_save, name='api_category_update'),
    path('api/definitions/categories/<int:category_id>/delete', views.api_category_delete, name='api_category_delete'),
    path('api/definitions/categories/<int:category_id>/active', views.api_category_active, name='api_category_active'),
    path('api/definitions/services', views.api_service_save, name='api_service_create'),
    path('api/definitions/services/<int:service_id>', views.api_service_save, name='api_service_update'),
    path('api/definitions/services/<int:service_id>/delete', views.api_service_delete, name='api_service_delete'),
    path('api/definitions/services/<int:service_id>/active', views.api_service_active, name='api_service_active'),
    
    path('api/passwords', views.api_passwords, name='api_passwords'),
    path('api/vault/fields', views.api_vault_fields, name='api_vault_fields'),
    path('api/launch-check', views.api_launch_check, name='api_launch_check'),
    path('api/launch/claim', views.api_launch_claim, name='api_launch_claim'),
    path('api/launch/status', views.api_launch_status, name='api_launch_status'),
    path('api/passwords/<int:password_id>', views.api_password_detail, name='api_password_detail'),
    path('api/passwords/<int:password_id>/delete', views.api_password_delete, name='api_password_delete'),
    path('api/passwords/<int:password_id>/history', views.api_password_history, name='api_password_history'),
    path('api/passwords/<int:password_id>/active', views.api_password_active, name='api_password_active'),
    
    path('api/generate-password', views.api_generate_password, name='api_generate_password'),
    path('api/dashboard/stats', views.api_dashboard_stats, name='api_dashboard_stats'),
    path('api/import', views.api_import_data, name='api_import_data'),
    path('api/profile/delete-account', views.api_delete_account, name='api_delete_account'),
    
    path('api/import-passwords', views.api_import_passwords, name='api_import_passwords'),
    path('api/export-passwords', views.api_export_passwords, name='api_export_passwords'),
    path('api/import-backup', views.api_import_backup, name='api_import_backup'),
]

# Static files are served by the app itself, also with DEBUG off. SafePass is a
# single-user local app, so Django's file server is enough (it blocks path traversal).
urlpatterns += [
    re_path(r'^static/(?P<path>.*)$', serve, {'document_root': settings.STATICFILES_DIRS[0]}),
]

handler400 = 'safepass.views.bad_request'
handler404 = 'safepass.views.page_not_found'
handler500 = 'safepass.views.server_error'
