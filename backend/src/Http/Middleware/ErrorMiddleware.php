<?php
declare(strict_types=1);

namespace Kritis\Http\Middleware;

use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Exception\HttpException as SlimHttpException;

final class ErrorMiddleware implements MiddlewareInterface
{
    public function __construct(private ResponseFactoryInterface $factory, private bool $debug, private ?string $logFile = null)
    {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        try {
            return $handler->handle($request);
        } catch (HttpException $e) {
            $body = ['error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]];
            if ($e->fields) {
                $body['error']['fields'] = $e->fields;
            }
            $r = Json::respond($this->factory->createResponse(), $body, $e->status);
            foreach ($e->headers as $k => $v) {
                $r = $r->withHeader($k, $v);
            }
            return $r;
        } catch (SlimHttpException $e) {
            $status = $e->getCode() ?: 500;
            $code = match ($status) {
                404 => 'not_found', 405 => 'method_not_allowed', default => 'http_error',
            };
            return Json::respond($this->factory->createResponse(), ['error' => ['code' => $code, 'message' => $status === 404 ? 'Nicht gefunden.' : $e->getMessage()]], $status);
        } catch (\Throwable $e) {
            if ($this->logFile) {
                @file_put_contents($this->logFile, date('c') . ' ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . "\n", FILE_APPEND);
            }
            $msg = $this->debug ? $e->getMessage() : 'Interner Fehler.';
            return Json::respond($this->factory->createResponse(), ['error' => ['code' => 'internal_error', 'message' => $msg]], 500);
        }
    }
}
