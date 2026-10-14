<?php
declare(strict_types=1);

namespace Kritis;

use Kritis\Controller\AuthController;
use Kritis\Controller\FacilityController;
use Kritis\Controller\HazardController;
use Kritis\Controller\ImportController;
use Kritis\Geo\FloodService;
use Kritis\Geo\WarningService;
use Kritis\Controller\GeocodeController;
use Kritis\Controller\MapController;
use Kritis\Geo\AdminResolver;
use Kritis\Controller\MasterDataController;
use Kritis\Controller\SituationController;
use Kritis\Geo\SituationService;
use Kritis\Geo\TileService;
use Kritis\Support\HttpClient;
use Kritis\Controller\UserController;
use Kritis\Http\Middleware\CsrfMiddleware;
use Kritis\Http\Middleware\ErrorMiddleware;
use Kritis\Http\Middleware\JsonBodyMiddleware;
use Kritis\Http\Middleware\RequireAuth;
use Kritis\Http\Middleware\SecurityHeaders;
use Kritis\Http\Middleware\SessionMiddleware;
use Kritis\Security\PasswordHasher;
use Kritis\Security\PasswordPolicy;
use Kritis\Security\RateLimiter;
use Kritis\Security\SessionStore;
use Kritis\Support\Config;
use Kritis\Support\Json;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App as SlimApp;
use Slim\Factory\AppFactory;
use Slim\Routing\RouteCollectorProxy;

final class App
{
    public static function create(Config $config, PDO $db): SlimApp
    {
        if (version_compare(PHP_VERSION, (string) $config->get('php_min_version', '8.3.0'), '<')) {
            throw new \RuntimeException('PHP ' . $config->get('php_min_version') . ' oder neuer erforderlich.');
        }
        $app = AppFactory::create();
        $factory = $app->getResponseFactory();

        $hasher = new PasswordHasher();
        $policy = new PasswordPolicy((int) $config->get('security.password_min_length', 12));
        $limiter = new RateLimiter($db);
        $store = new SessionStore($db, (int) $config->get('session.idle_ttl'), (int) $config->get('session.absolute_ttl'));
        $auth = new AuthController($db, $config, $hasher, $policy, $limiter, $store);
        $users = new UserController($db, $hasher, $store);
        $root = dirname(__DIR__, 2);
        $services = require $root . '/config/services.php';
        $basemaps = require $root . '/config/basemaps.php';
        $http = new HttpClient((string) $config->get('outbound_proxy', ''), (int) $services['http']['timeout'], (string) $services['http']['user_agent']);
        $tiles = new TileService($basemaps, $services, $config->get('storage') . '/tiles', $http, $config->get('storage') . '/cache');
        $map = new MapController($db, $basemaps, $tiles, $config->get('storage') . '/cache', $services);
        $facilities = new FacilityController($db, new AdminResolver($db));
        $import = new ImportController($db, $facilities);
        $geocode = new GeocodeController($services['geocoding'], $http, $config->get('storage') . '/cache');
        $situation = new SituationController($db, new SituationService($db));
        $cache = $config->get('storage') . '/cache';
        $hazards = new HazardController($db, new WarningService($services['warnings'], $http, $cache), new FloodService($services['wms']['hochwasser'], $http, $cache), $services);
        $master = ['categories' => new MasterDataController($db, 'categories'), 'scenarios' => new MasterDataController($db, 'scenarios')];

        $any = fn () => new RequireAuth($db);
        $admin = fn () => new RequireAuth($db, ['admin']);
        $pwOk = fn () => new RequireAuth($db, [], true);

        $app->group('/api', function (RouteCollectorProxy $g) use ($auth, $users, $master, $map, $facilities, $import, $geocode, $situation, $hazards, $any, $admin, $pwOk, $db) {
            $g->get('/health', function (Request $q, Response $r) use ($db) {
                $db->query('SELECT 1');
                return Json::respond($r, ['status' => 'ok']);
            });
            $g->get('/auth/me', [$auth, 'me']);
            $g->post('/auth/login', [$auth, 'login']);
            $g->post('/auth/logout', [$auth, 'logout']);
            $g->post('/auth/change-password', [$auth, 'changePassword'])->add($pwOk());

            $g->get('/users', [$users, 'list'])->add($admin());
            $g->post('/users', [$users, 'create'])->add($admin());
            $g->put('/users/{id}', [$users, 'update'])->add($admin());
            $g->delete('/users/{id}', [$users, 'delete'])->add($admin());
            $g->post('/users/{id}/reset-password', [$users, 'resetPassword'])->add($admin());

            $g->get('/map/config', [$map, 'config'])->add($any());
            $g->get('/boundaries/{level}', [$map, 'boundaries'])->add($any());
            $g->get('/tiles/{basemap:[a-z0-9_-]+}/{z}/{x}/{y}.png', [$map, 'tile'])->add($any());

            $g->get('/facilities', [$facilities, 'list'])->add($any());
            $g->post('/facilities', [$facilities, 'create'])->add($admin());
            $g->get('/facilities/{id:[0-9]+}', [$facilities, 'get'])->add($any());
            $g->put('/facilities/{id:[0-9]+}', [$facilities, 'update'])->add($admin());
            $g->delete('/facilities/{id:[0-9]+}', [$facilities, 'delete'])->add($admin());
            $g->get('/geo/resolve', [$facilities, 'resolve'])->add($any());
            $g->get('/geocode', [$geocode, 'search'])->add($admin());
            $g->post('/import/commit', [$import, 'commit'])->add($admin());

            $g->post('/situation/query', [$situation, 'query'])->add($any());
            $g->get('/warnings', [$hazards, 'warnings'])->add($any());
            $g->get('/wms/hochwasser', [$hazards, 'floodMap'])->add($any());
            $g->post('/facilities/hints', [$hazards, 'hints'])->add($admin());
            $g->get('/events', [$situation, 'list'])->add($any());
            $g->post('/events', [$situation, 'create'])->add($any());
            $g->get('/events/{id:[0-9]+}', [$situation, 'get'])->add($any());
            $g->put('/events/{id:[0-9]+}', [$situation, 'update'])->add($any());
            $g->delete('/events/{id:[0-9]+}', [$situation, 'delete'])->add($admin());

            foreach ($master as $path => $ctl) {
                $g->get("/$path", [$ctl, 'list'])->add($any());
                $g->post("/$path", [$ctl, 'create'])->add($admin());
                $g->put("/$path/order", [$ctl, 'reorder'])->add($admin());
                $g->put("/$path/{id:[0-9]+}", [$ctl, 'update'])->add($admin());
                $g->delete("/$path/{id:[0-9]+}", [$ctl, 'delete'])->add($admin());
            }
        })->add(new CsrfMiddleware())->add(new JsonBodyMiddleware(8_000_000)); // Import: bis 5000 Zeilen

        // Reihenfolge (zuletzt hinzugefügt = äußerste Schicht): Headers → Session → Fehler → Routing
        $app->addRoutingMiddleware();
        $app->add(new ErrorMiddleware($factory, $config->get('env') === 'development', $config->get('storage') . '/logs/error.log'));
        $app->add(new SessionMiddleware($store, (bool) $config->get('session.cookie_secure')));
        $app->add(new SecurityHeaders((bool) $config->get('security.hsts')));
        return $app;
    }
}
