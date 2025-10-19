module.exports = {
    apps: [
        {
            name: "pixelbypixel_nyc",
            script: "./server.js",
            env: {
                PORT: 3003,
                NODE_ENV: "development"
            },
            env_production: {
                PORT: 3003,
                NODE_ENV: "production"
            }
        }
    ]
};