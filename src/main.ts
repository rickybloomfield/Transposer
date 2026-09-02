import './style.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) (window as unknown as { __app?: App }).__app = new App(root);
