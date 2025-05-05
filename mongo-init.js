db.createUser({
  user: 'admin',
  pwd: 'adminpassword',
  roles: [
    { role: 'readWrite', db: 'search_logs' },
    { role: 'dbAdmin', db: 'search_logs' }
  ]
});