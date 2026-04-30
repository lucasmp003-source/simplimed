import argparse
import yaml

from abc import *

from utils.utils import get_relative_path

class BaseConfig(metaclass=ABCMeta):
    """Base configuration class to handle arguments and load configuration files"""

    def __init__(self):

        default_config = "config/base_config.yaml"
        default_price_config = "config/price_config.yaml"
        default_model_config= "config/models.yaml"
        # Parse command-line arguments
        parser = argparse.ArgumentParser(description="Arguments")
        parser.add_argument(
            "--config", type=str, default=default_config, help="Path to environment config file"
        )
        parser.add_argument(
            "--model_config", type=str, default=default_model_config, help="Path to environment model_config file"
        )
        parser.add_argument(
            "--price", action="store_true", help="Enable price calculation"
        )
        parser.add_argument(
            "--price_config", type=str, default=default_price_config, help="Path to pricing config file"
        )
        parser.add_argument(
            "--load_preprocess", action="store_true", help="Load preprocessed data"
        )
        parser.add_argument(
            "--save_preprocess", action="store_true", help="Save preprocessed data"
        )
        parser.add_argument(
            "--task", type=str, default="generation", help="Task type for processing, can be full_report, simplification or generation."
        )

        args = parser.parse_args()

        # Load environment configuration YAML file
        config_data = self._load_yaml(args.config)

        # Load price configuration only if --price is enabled
        price_config_data = self._load_yaml(args.price_config) if args.price else None

        model_config_data = self._load_yaml(args.model_config)

        # Combine configurations
        self.config = {
            "runtime-config": vars(args),
            "yaml-config": config_data,
            "price-config": price_config_data,
            "models-paths": model_config_data
        }

    @staticmethod
    def _load_yaml(filepath):
        """Load a YAML file and return its contents as a dictionary"""
        with open(filepath, "r") as file:
            return yaml.load(file, Loader=yaml.FullLoader)
